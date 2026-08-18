import { Router, Request, Response } from 'express';
import { EndpointDependencies, OpenAIChatRequest, OpenAIChatResponse } from '../../types.js';
import { getLogConfig } from '../../../app/config.js';
import { logger } from '../../../app/logger.js';
import { convertOpenAIChatMessages, extractSystemMessage } from '../../message-converter.js';
import { parseResponseFormat, buildJsonFormatInstruction, stripJsonFences } from '../../response-format.js';
import { getMetrics } from '../../../app/metrics.js';
import { ChatCompletionEventEmitter } from './events.js';
import type { Turn } from '../../../lumo-client/index.js';
import type { ConversationId } from '../../../conversations/types.js';
import { flattenAndTrackClientTools } from '../../tools/call-id.js';
import { createStreamingToolProcessor } from '../../tools/streaming-processor.js';
import { extractClientToolNames } from '../../tools/prefix.js';
import {
  buildRequestContext,
  persistTitle,
  persistAssistantTurn,
  generateChatCompletionId,
  mapToolCallsForPersistence,
  tryExecuteCommand,
  setSSEHeaders,
  toOpenAIChatUsage,
} from '../shared.js';
import {
  conversationIdFromUserField,
  invalidModelOrEffort,
  isDebugLogging,
  persistInboundTurns,
  tryPrepareTools,
  resolveRequestTier,
} from '../../request-prep.js';
import { sendInvalidRequest, sendServerError } from '../../error-handler.js';

export function createChatCompletionsRouter(deps: EndpointDependencies): Router {
  const router = Router();

  router.post('/v1/chat/completions', async (req: Request, res: Response) => {
    try {
      const request: OpenAIChatRequest = req.body;

      logger.info({
        model: request.model,
        stream: request.stream ?? false,
        messageCount: Array.isArray(request.messages) ? request.messages.length : 0,
        toolNames: extractClientToolNames(request.tools),
        messageRoles: Array.isArray(request.messages)
          ? request.messages.map((m) => {
              const obj = m as { role?: string; type?: string; tool_calls?: Array<{ function?: { name?: string } }> };
              return {
                role: obj.role,
                type: obj.type,
                toolCalls: obj.tool_calls?.map((tc) => tc.function?.name).filter(Boolean),
              };
            })
          : [],
      }, '[chat-completions] request');

      if (isDebugLogging()) {
        const debugMessages = Array.isArray(request.messages)
          ? request.messages.map((m, i) => {
              const content = typeof m.content === 'string' ? m.content : '';
              return {
                i,
                role: m.role,
                contentLength: content.length,
                preview: getLogConfig().messageContent ? content.slice(0, 120).replace(/\n/g, '\\n') : 'hidden',
              };
            })
          : [];
        logger.debug({
          model: request.model,
          stream: request.stream ?? false,
          messageCount: Array.isArray(request.messages) ? request.messages.length : 0,
          debugMessages,
        }, '[chat-completions] inbound request summary');
      }

      // Validate request
      if (!Array.isArray(request.messages) || request.messages.length === 0) {
        return sendInvalidRequest(res, 'messages must be a non-empty array', 'messages', 'missing_messages');
      }

      request.messages = flattenAndTrackClientTools(request.messages);

      // Get the last user message
      const lastUserMessage = [...request.messages].reverse().find(m =>
        m.role === 'user' || m.role === 'tool' || (m as { type?: string }).type === 'function_call_output'
      );
      if (!lastUserMessage) {
        return sendInvalidRequest(res, 'At least one user message is required', 'messages', 'missing_user_message');
      }

      const modelError = invalidModelOrEffort(request.model, request.reasoning_effort, 'reasoning_effort');
      if (modelError) {
        return sendInvalidRequest(res, modelError.message, modelError.param, modelError.code);
      }

      const conversationId = conversationIdFromUserField(request.user);

      // ===== Convert messages to Lumo turns =====
      const turns = await convertOpenAIChatMessages(request.messages);

      // ===== Build instructions (injected in LumoClient, not persisted) =====
      const systemContent = extractSystemMessage(request.messages);
      let jsonFormat;
      try {
        jsonFormat = parseResponseFormat(request.response_format);
      } catch (error) {
        return sendInvalidRequest(
          res,
          error instanceof Error ? error.message : 'Invalid response_format',
          'response_format',
          'invalid_response_format',
        );
      }
      const prepared = tryPrepareTools(
        request.tools,
        request.tool_choice,
        systemContent,
        jsonFormat ? buildJsonFormatInstruction(jsonFormat) : undefined,
        turns.filter((t) => t.role === 'user').length > 1,
      );
      if (!prepared.ok) {
        return sendInvalidRequest(res, prepared.message, 'tool_choice', 'invalid_tool_choice');
      }
      const { tools: effectiveTools, instructions, injectInto } = prepared.prepared;

      persistInboundTurns(deps, conversationId, turns);

      // Add to queue and process
      await handleChatRequest(res, deps, request, turns, conversationId, request.stream ?? false, instructions, injectInto, effectiveTools);
    } catch (error) {
      logger.error('Error processing chat completion:');
      logger.error(error);
      return sendServerError(res);
    }
  });

  return router;
}

async function handleChatRequest(
  res: Response,
  deps: EndpointDependencies,
  request: OpenAIChatRequest,
  turns: Turn[],
  conversationId: ConversationId | undefined,
  streaming: boolean,
  instructions: string | undefined,
  injectInstructionsInto: 'first' | 'last',
  effectiveTools?: OpenAIChatRequest['tools'],
): Promise<void> {
  const id = generateChatCompletionId();
  const created = Math.floor(Date.now() / 1000);
  const { name: model, tier, enableReasoning, surfaceThinking } = resolveRequestTier(
    request.model,
    request.reasoning_effort,
  );
  const ctx = buildRequestContext(deps, conversationId, effectiveTools);
  let jsonMode = false;
  try {
    jsonMode = !!parseResponseFormat(request.response_format);
  } catch {
    jsonMode = false;
  }

  // Streaming setup
  const emitter = streaming ? new ChatCompletionEventEmitter(res, id, created, model) : null;
  if (emitter) {
    setSSEHeaders(res);
  }

  let accumulatedText = '';
  let reasoningContent: string | undefined;
  let toolCalls: typeof processor.toolCallsEmitted | undefined;
  let usage = toOpenAIChatUsage();

  const processor = createStreamingToolProcessor(
    ctx.hasCustomTools,
    {
      emitTextDelta(text) {
        accumulatedText += text;
        if (!jsonMode) {
          emitter?.emitContentDelta(text);
        }
      },
      emitToolCall(callId, tc) {
        emitter?.emitToolCallDelta(callId, tc.name, tc.arguments);
      },
    },
    extractClientToolNames(request.tools),
  );

  // Check for command before calling Lumo
  const commandResult = await tryExecuteCommand(turns, ctx.commandContext);
  if (commandResult) {
    accumulatedText = commandResult.response;
    if (!jsonMode) {
      emitter?.emitContentDelta(accumulatedText);
    }
  } else {
    // Normal flow: call Lumo
    try {
      const result = await deps.queue.add(async () =>
        deps.lumoClient!.chatWithHistory(turns, processor.onChunk, {
          requestTitle: ctx.requestTitle,
          instructions,
          injectInstructionsInto,
          modelTier: tier,
          enableReasoning,
          onReasoning: surfaceThinking && emitter
            ? (text) => emitter.emitReasoningDelta(text)
            : undefined,
        })
      );

      logger.debug('[Server] Stream completed');
      if (surfaceThinking && !streaming && result.reasoning) {
        reasoningContent = result.reasoning;
      }
      processor.finalize();
      persistTitle(result, deps, conversationId);
      toolCalls = processor.toolCallsEmitted.length > 0 ? processor.toolCallsEmitted : undefined;

      persistAssistantTurn(
        deps,
        conversationId,
        result.message,
        mapToolCallsForPersistence(processor.toolCallsEmitted)
      );
      getMetrics()?.lumoCompletionsTotal.inc({
        tier,
        reasoning: enableReasoning ? 'true' : 'false',
      });
      usage = toOpenAIChatUsage(result.usage);
    } catch (error) {
      logger.error({ error }, 'Chat completion error');
      if (emitter) {
        emitter.emitError(error as Error);
      } else {
        sendServerError(res);
      }
      return;
    }
  }

  // Build and send response (shared for both command and normal flow)
  try {
    if (jsonMode) {
      accumulatedText = stripJsonFences(accumulatedText);
    }
    if (emitter) {
      if (jsonMode) {
        emitter.emitContentDelta(accumulatedText);
      }
      emitter.emitDone(toolCalls, usage);
    } else {
      const response: OpenAIChatResponse = {
        id,
        object: 'chat.completion',
        created,
        model,
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: accumulatedText,
            ...(toolCalls ? { tool_calls: toolCalls } : {}),
            ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
          },
          finish_reason: toolCalls ? 'tool_calls' : 'stop',
        }],
        ...(usage ? { usage } : {}),
      };
      res.json(response);
    }
  } catch (error) {
    logger.error({ error }, 'Error sending chat completion response');
    if (emitter) {
      emitter.emitError(error as Error);
    } else {
      sendServerError(res);
    }
  }
}
