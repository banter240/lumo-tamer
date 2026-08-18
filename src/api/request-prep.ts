/**
 * Shared request prep for /v1/chat/completions and /v1/responses.
 * Keep route files as glue; put ID, validation, and instruction assembly here.
 */

import { logger } from '../app/logger.js';
import { getConversationsConfig, getCustomToolsConfig, getReasoningConfig, getServerConfig, getServerInstructionsConfig } from '../app/config.js';
import { deterministicUUID } from '../app/id-generator.js';
import { getMetrics } from '../app/metrics.js';
import { advertisedModelIds, isModelAllowed, isValidReasoningEffort, normalizeModelId, resolveModel, resolveReasoning } from '../lumo-client/model-tier.js';
import type { LumoModelTier } from '../lumo-client/types.js';
import { buildInstructions } from './instructions.js';
import { parseToolChoice, toolChoiceInstruction, toolsForChoice } from './tools/tool-choice.js';
import type { ConversationId } from '../conversations/types.js';
import type { EndpointDependencies, OpenAITool } from './types.js';
import type { Turn } from '../lumo-client/index.js';

export function conversationIdFromUser(user: string): ConversationId {
  return deterministicUUID(`user:${user}`);
}

export function conversationIdFromClient(clientId: string): ConversationId {
  return deterministicUUID(`conversation:${clientId}`);
}

export function conversationIdFromUserField(user?: string): ConversationId | undefined {
  if (!getConversationsConfig()?.deriveIdFromUser || !user) {
    return undefined;
  }
  return conversationIdFromUser(user);
}

/** Re-inject tool protocol on every turn. Long coding sessions forget a first-only inject. */
export function resolveInjectInto(toolCount: number | undefined): 'first' | 'last' {
  const configured = getServerInstructionsConfig().injectInto;
  if (toolCount && toolCount > 0 && getCustomToolsConfig().enabled) {
    return 'last';
  }
  return configured;
}

export function appendInstructions(...parts: Array<string | undefined>): string {
  return parts.filter((part): part is string => !!part && part.trim().length > 0).join('\n\n');
}

export interface InvalidField {
  message: string;
  param: string;
  code: string;
}

export function invalidModelOrEffort(
  model: unknown,
  effort: unknown,
  effortParam: 'reasoning_effort' | 'reasoning.effort',
): InvalidField | null {
  if (model !== undefined && model !== null) {
    const cfg = getServerConfig();
    const allowed = advertisedModelIds(cfg.allowedModels, cfg.extraModels);
    if (typeof model !== 'string' || !isModelAllowed(normalizeModelId(model), allowed)) {
      return {
        message: `Unknown model '${String(model)}'. Allowed models: ${allowed.join(', ')}`,
        param: 'model',
        code: 'model_not_found',
      };
    }
  }
  if (!isValidReasoningEffort(effort)) {
    return {
      message: `Invalid ${effortParam} '${String(effort)}'. Allowed: none, low, medium, high`,
      param: effortParam,
      code: 'invalid_reasoning_effort',
    };
  }
  return null;
}

export function resolveRequestTier(model: unknown, effort: unknown): {
  name: string;
  tier: LumoModelTier;
  enableReasoning: boolean;
  surfaceThinking: boolean;
} {
  const serverConfig = getServerConfig();
  const resolved = resolveModel(
    model,
    serverConfig.allowedModels,
    serverConfig.extraModels,
    serverConfig.defaultModelTier,
  );
  const tier = resolved?.tier ?? serverConfig.defaultModelTier;
  const reasoningConfig = getReasoningConfig();
  return {
    name: (typeof model === 'string' && model) ? model : serverConfig.apiModelName,
    tier,
    enableReasoning: resolveReasoning(
      typeof effort === 'string' ? effort : undefined,
      reasoningConfig.default === 'high',
      tier,
      resolved?.reasoning,
    ),
    surfaceThinking: reasoningConfig.surfaceThinking,
  };
}

export type PreparedTools = {
  tools?: OpenAITool[];
  instructions: string;
  injectInto: 'first' | 'last';
};

export function prepareToolsAndInstructions(
  tools: OpenAITool[] | undefined,
  rawChoice: unknown,
  clientInstructions?: string,
  extraInstructions?: string,
  compact = false,
): PreparedTools {
  const choice = parseToolChoice(rawChoice);
  const effective = toolsForChoice(tools, choice);
  return {
    tools: effective,
    instructions: appendInstructions(
      buildInstructions(effective, clientInstructions, { compact }),
      toolChoiceInstruction(choice),
      extraInstructions,
    ),
    injectInto: resolveInjectInto(effective?.length),
  };
}

export function tryPrepareTools(
  tools: OpenAITool[] | undefined,
  rawChoice: unknown,
  clientInstructions?: string,
  extraInstructions?: string,
  compact = false,
): { ok: true; prepared: PreparedTools } | { ok: false; message: string } {
  try {
    return {
      ok: true,
      prepared: prepareToolsAndInstructions(tools, rawChoice, clientInstructions, extraInstructions, compact),
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Invalid tool_choice',
    };
  }
}

/** Title generation is a second Lumo call. Only worth it when we sync to Proton. */
export function shouldRequestTitle(
  deps: EndpointDependencies,
  conversationId: ConversationId | undefined,
): boolean {
  if (!conversationId || !deps.syncInitialized) {
    return false;
  }
  return deps.conversationStore?.get(conversationId)?.title === 'New Conversation';
}

export function persistInboundTurns(
  deps: EndpointDependencies,
  conversationId: ConversationId | undefined,
  turns: Turn[],
): void {
  if (conversationId && deps.conversationStore && turns.length > 0) {
    deps.conversationStore.appendMessages(conversationId, turns);
    logger.debug({ conversationId, messageCount: turns.length }, 'Persisted conversation messages');
    return;
  }
  if (!conversationId) {
    getMetrics()?.messagesTotal.inc({ role: 'user' });
  }
}

export function isDebugLogging(): boolean {
  const debug = (logger as { isLevelEnabled?: (level: string) => boolean }).isLevelEnabled;
  return typeof debug === 'function' && debug.call(logger, 'debug');
}
