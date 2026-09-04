import { Response } from 'express';
import {
  EndpointDependencies,
  OpenAIResponseRequest,
  OpenAIResponse,
  OutputItem,
  MessageOutputItem,
  FunctionCallOutputItem,
  ReasoningOutputItem,
} from '../../types.js';
import { getServerConfig } from '../../../app/config.js';
import { estimatePromptTokens } from '../../../app/token-estimate.js';
import { logger } from '../../../app/logger.js';
import { ResponseEventEmitter } from './events.js';
import type { Turn } from '../../../lumo-client/index.js';
import type { ConversationId } from '../../../conversations/index.js';
import { generateCallId } from '../../tools/call-id.js';
import { createStreamingToolProcessor } from '../../tools/streaming-processor.js';
import { extractClientToolNames } from '../../tools/prefix.js';
import {
  buildRequestContext,
  persistTitle,
  persistAssistantTurn,
  generateResponseId,
  generateItemId,
  mapToolCallsForPersistence,
  tryExecuteCommand,
  setSSEHeaders,
  type ToolCallForPersistence,
} from '../shared.js';
import { sendServerError, isAuthError, sendAuthRequired } from '../../error-handler.js';
import { getMetrics } from '../../../app/metrics.js';
import { resolveRequestTier } from '../../request-prep.js';

// ── Output building ────────────────────────────────────────────────

interface ToolCall {
  name: string;
  arguments: string | object;
}

interface BuildOutputOptions {
  text: string;
  toolCalls?: ToolCall[] | null;
  itemId?: string;
  reasoning?: string;
  reasoningItemId?: string;
}

function buildOutputItems(options: BuildOutputOptions): OutputItem[] {
  const { text, toolCalls, itemId, reasoning, reasoningItemId } = options;

  const output: OutputItem[] = [];

  if (reasoning) {
    output.push({
      type: 'reasoning',
      id: reasoningItemId || generateItemId(),
      status: 'completed',
      content: [{ type: 'reasoning_text', text: reasoning }],
    } satisfies ReasoningOutputItem);
  }

  const messageItem: MessageOutputItem = {
    type: 'message',
    id: itemId || generateItemId(),
    status: 'completed',
    role: 'assistant',
    content: [
      {
        type: 'output_text',
        text,
        annotations: [],
      },
    ],
  };

  output.push(messageItem);

  if (toolCalls && toolCalls.length > 0) {
    for (const toolCall of toolCalls) {
      const argumentsJson = typeof toolCall.arguments === 'string'
        ? toolCall.arguments
        : JSON.stringify(toolCall.arguments);

      // Use pre-generated call_id if available, otherwise generate new one
      const callId = 'call_id' in toolCall
        ? (toolCall as ToolCallForPersistence).call_id
        : generateCallId(toolCall.name, true);

      output.push({
        type: 'function_call',
        // Same value for id and call_id: some clients echo item.id as the next call_id.
        id: callId,
        call_id: callId,
        status: 'completed',
        name: toolCall.name,
        arguments: argumentsJson,
      } satisfies FunctionCallOutputItem);
    }
  }

  return output;
}

// ── Response factory ───────────────────────────────────────────────

function createCompletedResponse(
  responseId: string,
  createdAt: number,
  request: OpenAIResponseRequest,
  output: OutputItem[],
  completionTokens?: number,
): OpenAIResponse {
  const bytes = request.input ? Buffer.byteLength(JSON.stringify(request.input), 'utf8') : 0;
  const estimatedInputTokens = estimatePromptTokens(
    bytes,
    getServerConfig().promptTokenEstimation,
    getServerConfig().promptTokenEstimationFactor ?? 1.0,
  );
  return {
    id: responseId,
    object: 'response',
    created_at: createdAt,
    status: 'completed',
    completed_at: Math.floor(Date.now() / 1000),
    error: null,
    incomplete_details: null,
    instructions: request.instructions ?? null,
    max_output_tokens: request.max_output_tokens ?? request.max_tokens ?? null,
    model: request.model || getServerConfig().apiModelName,
    output,
    parallel_tool_calls: false,
    previous_response_id: request.previous_response_id ?? null,
    reasoning: {
      effort: request.reasoning?.effort ?? null,
      summary: null,
    },
    store: request.store ?? false,
    temperature: request.temperature ?? 1.0,
    text: {
      format: {
        type: 'text',
      },
    },
    tool_choice: request.tools && request.tools.length > 0 ? 'auto' : 'none',
    tools: request.tools ?? [],
    top_p: 1.0,
    truncation: 'auto',
    usage: completionTokens == null ? null : {
      input_tokens: estimatedInputTokens,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: completionTokens,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: estimatedInputTokens + completionTokens,
    },
    user: request.user ?? null,
    metadata: request.metadata || {},
  };
}

// ── Unified handler ────────────────────────────────────────────────

export async function handleRequest(
  res: Response,
  deps: EndpointDependencies,
  request: OpenAIResponseRequest,
  turns: Turn[],
  conversationId: ConversationId | undefined,
  streaming: boolean,
  instructions: string | undefined,
  injectInstructionsInto: 'first' | 'last'
): Promise<void> {
  const id = generateResponseId();
  const itemId = generateItemId();
  const createdAt = Math.floor(Date.now() / 1000);
  const { name: model, tier, enableReasoning, surfaceThinking } = resolveRequestTier(
    request.model,
    request.reasoning?.effort,
  );
  const ctx = buildRequestContext(deps, conversationId, request.tools);

  // Streaming setup
  const emitter = streaming ? new ResponseEventEmitter(res) : null;
  if (emitter) {
    setSSEHeaders(res);
    emitter.emitResponseCreated(id, createdAt, model);
    emitter.emitResponseInProgress(id, createdAt, model);
    emitter.emitOutputItemAdded(
      { id: itemId, type: 'message', role: 'assistant', status: 'in_progress', content: [] },
      0
    );
    emitter.emitContentPartAdded(itemId, 0, 0);
  }

  logger.debug({ hasCustomTools: ctx.hasCustomTools, toolCount: request.tools?.length }, '[Server] Tool detector state');

  let accumulatedText = '';
  let reasoningText = '';
  let reasoningItemId: string | undefined;
  let reasoningOutputIndex = 1;
  let toolCallsForPersist: ToolCallForPersistence[] | undefined;
  let completionTokens: number | undefined;

  // Check for command before calling Lumo
  const commandResult = await tryExecuteCommand(turns, ctx.commandContext);
  if (commandResult) {
    accumulatedText = commandResult.response;
    emitter?.emitOutputTextDelta(itemId, 0, 0, accumulatedText);
  } else {
    // Normal flow: call Lumo
    let nextOutputIndex = 1;
    const processor = createStreamingToolProcessor(
      ctx.hasCustomTools,
      {
        emitTextDelta(text) {
          accumulatedText += text;
          emitter?.emitOutputTextDelta(itemId, 0, 0, text);
        },
        emitToolCall(callId, tc) {
          emitter?.emitFunctionCallEvents(callId, callId, tc.name, JSON.stringify(tc.arguments), nextOutputIndex++);
        },
      },
      extractClientToolNames(request.tools),
    );

    const emitReasoning = (text: string) => {
      if (!text) return;
      reasoningText += text;
      if (!emitter) return;
      if (!reasoningItemId) {
        reasoningItemId = generateItemId();
        reasoningOutputIndex = nextOutputIndex++;
        emitter.emitOutputItemAdded(
          { id: reasoningItemId, type: 'reasoning', status: 'in_progress', content: [] },
          reasoningOutputIndex,
        );
        emitter.emitReasoningPartAdded(reasoningItemId, reasoningOutputIndex, 0);
      }
      emitter.emitReasoningTextDelta(reasoningItemId, reasoningOutputIndex, 0, text);
    };

    try {
      const result = await deps.queue.add(async () =>
        deps.lumoClient!.chatWithHistory(turns, processor.onChunk, {
          requestTitle: ctx.requestTitle,
          instructions,
          injectInstructionsInto,
          modelTier: tier,
          enableReasoning,
          onReasoning: surfaceThinking ? emitReasoning : undefined,
        })
      );

      logger.debug('[Server] Stream completed');
      if (surfaceThinking && !streaming && result.reasoning) {
        reasoningText = result.reasoning;
        reasoningItemId = reasoningItemId || generateItemId();
      }
      processor.finalize();
      persistTitle(result, deps, conversationId);
      toolCallsForPersist = mapToolCallsForPersistence(processor.toolCallsEmitted);

      persistAssistantTurn(deps, conversationId, result.message, toolCallsForPersist);
      getMetrics()?.lumoCompletionsTotal.inc({
        tier,
        reasoning: enableReasoning ? 'true' : 'false',
      });
      completionTokens = result.usage?.completion_tokens;
    } catch (error) {
      logger.error({ error }, 'Response error');
      if (emitter) {
        emitter.emitError(error as Error);
        res.end();
      } else {
        if (isAuthError(error)) {
          sendAuthRequired(res);
        } else {
          sendServerError(res);
        }
      }
      return;
    }
  }

  // Build and send response (shared for both command and normal flow)
  try {
    const output = buildOutputItems({
      text: accumulatedText,
      itemId,
      toolCalls: toolCallsForPersist,
      reasoning: surfaceThinking ? reasoningText || undefined : undefined,
      reasoningItemId,
    });
    const response = createCompletedResponse(id, createdAt, request, output, completionTokens);

    if (emitter) {
      if (reasoningItemId && reasoningText) {
        emitter.emitReasoningTextDone(reasoningItemId, reasoningOutputIndex, 0, reasoningText);
        emitter.emitReasoningPartDone(reasoningItemId, reasoningOutputIndex, 0, reasoningText);
        emitter.emitOutputItemDone(
          {
            id: reasoningItemId,
            type: 'reasoning',
            status: 'completed',
            content: [{ type: 'reasoning_text', text: reasoningText }],
          },
          reasoningOutputIndex,
        );
      }
      emitter.emitOutputTextDone(itemId, 0, 0, accumulatedText);
      emitter.emitContentPartDone(itemId, 0, 0, accumulatedText);
      emitter.emitOutputItemDone(
        {
          id: itemId,
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: accumulatedText, annotations: [] }],
        },
        0
      );
      emitter.emitResponseCompleted(response);
      res.end();
    } else {
      res.json(response);
    }
  } catch (error) {
    logger.error({ error }, 'Error sending response');
    if (emitter) {
      emitter.emitError(error as Error);
      res.end();
    } else {
      sendServerError(res);
    }
  }
}
