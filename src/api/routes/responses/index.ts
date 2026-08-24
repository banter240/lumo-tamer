import { Router, Request, Response } from 'express';
import { EndpointDependencies, OpenAIResponseRequest } from '../../types.js';
import { logger } from '../../../app/logger.js';
import { handleRequest } from './request-handlers.js';
import { convertOpenAIResponseMessages } from '../../message-converter.js';
import { flattenAndTrackClientTools } from '../../tools/call-id.js';
import { sendInvalidRequest, sendServerError, isAuthError, sendAuthRequired } from '../../error-handler.js';
import {
  conversationIdFromClient,
  conversationIdFromUserField,
  invalidModelOrEffort,
  persistInboundTurns,
  tryPrepareTools,
} from '../../request-prep.js';

import type { ConversationId } from '../../../conversations/index.js';

function conversationIdFromResponsesRequest(request: OpenAIResponseRequest): ConversationId | undefined {
  let clientId: string | undefined;
  if (!request.conversation) return undefined;
  if (typeof request.conversation === 'string') clientId = request.conversation;
  else if (typeof request.conversation === 'object' && 'id' in request.conversation) {
    clientId = request.conversation.id;
  }
  return clientId ? conversationIdFromClient(clientId) : undefined;
}

export function createResponsesRouter(deps: EndpointDependencies): Router {
  const router = Router();

  // NOTE: Module-level state has been moved to ConversationStore (per-conversation)
  // This fixes issues with server-global state shared across conversations

  router.post('/v1/responses', async (req: Request, res: Response) => {
    try {
      const request: OpenAIResponseRequest = req.body;

      // ===== STEP 1: Determine conversation ID =====
      // Without a deterministic ID, treat the request as stateless (no persistence/dedup).
      if (request.previous_response_id && request.conversation) {
        return sendInvalidRequest(
          res,
          'previous_response_id and conversation cannot be used together',
          'previous_response_id',
          'mutually_exclusive_fields'
        );
      }

      const conversationId =
        conversationIdFromResponsesRequest(request)
        ?? (request.previous_response_id || undefined)
        ?? conversationIdFromUserField(request.user);

      // ===== STEP 2: Validate input =====
      if (request.input === undefined || request.input === null) {
        return sendInvalidRequest(res, 'input is required (string or message array)', 'input', 'missing_input');
      }
      // Text-extracted tool calls use synthetic call_ids. OpenCode echoes them
      // as function_call_output; Lumo never issued those IDs (400 + retry loop).
      // Flatten before validation so a follow-up that is only tool output
      // still counts as a user message.
      if (Array.isArray(request.input)) {
        request.input = flattenAndTrackClientTools(request.input);
      }
      if (Array.isArray(request.input)) {
        const hasUserMessage = request.input.some((m) => {
          if (typeof m !== 'object' || m === null) return false;
          const obj = m as { role?: string; type?: string };
          return obj.role === 'user' || obj.role === 'tool' || obj.type === 'function_call_output';
        });
        if (!hasUserMessage) {
          return sendInvalidRequest(res, 'input array must include at least one user message', 'input', 'missing_user_message');
        }
      }

      const modelError = invalidModelOrEffort(request.model, request.reasoning?.effort, 'reasoning.effort');
      if (modelError) {
        return sendInvalidRequest(res, modelError.message, modelError.param, modelError.code);
      }

      // ===== STEP 3: Convert input to turns =====
      // Handles normal messages, function_call, and function_call_output items.
      const turns = await convertOpenAIResponseMessages(request.input, request.instructions);

      // ===== Build instructions (injected in LumoClient, not persisted) =====
      const prepared = tryPrepareTools(
        request.tools,
        request.tool_choice,
        request.instructions,
        undefined,
        turns.filter((t) => t.role === 'user').length > 1,
      );
      if (!prepared.ok) {
        return sendInvalidRequest(res, prepared.message, 'tool_choice', 'invalid_tool_choice');
      }
      request.tools = prepared.prepared.tools;
      const { instructions, injectInto } = prepared.prepared;

      persistInboundTurns(deps, conversationId, turns);

      // ===== STEP 6: Add to queue and process =====
      await handleRequest(res, deps, request, turns, conversationId, request.stream ?? false, instructions, injectInto);
    } catch (error) {
      logger.error('Error processing response:');
      logger.error(error);
      return sendServerError(res);
    }
  });

  return router;
}
