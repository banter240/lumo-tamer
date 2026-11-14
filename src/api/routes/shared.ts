import { randomUUID } from "crypto";
import type { Response } from "express";
import {
  getCustomToolsConfig,
  getEnableImageTools,
  getServerConfig,
} from "../../app/config.js";
import { describeAttachedImages } from "../../vision/describe-images.js";
import { shouldRequestTitle } from "../request-prep.js";
import { getMetrics } from "../../app/metrics";
import { logger } from "../../app/logger.js";
import type { CommandContext } from "../../app/commands.js";
import type {
  EndpointDependencies,
  OpenAITool,
  OpenAIToolCall,
} from "../types.js";
import type { ConversationId } from "../../conversations/types.js";
import type {
  ChatResult,
  AssistantMessageData,
  LumoUsage,
  Turn,
} from "../../lumo-client/index.js";
import type { LumoModelTier } from "../../lumo-client/types.js";
import type { OpenAIChatResponse } from "../types.js";

// Re-export for convenience
export { tryExecuteCommand, type CommandResult } from "../../app/commands.js";

// ── Tool call type for persistence ─────────────────────────────────

/** Tool call with call_id for persistence and response building. */
export interface ToolCallForPersistence {
  name: string;
  arguments: string;
  call_id: string;
}

/**
 * Map emitted tool calls to format needed for persistence.
 * Returns undefined if no tool calls were emitted.
 */
export function mapToolCallsForPersistence(
  toolCallsEmitted: OpenAIToolCall[],
): ToolCallForPersistence[] | undefined {
  if (toolCallsEmitted.length === 0) return undefined;
  return toolCallsEmitted.map((tc) => ({
    name: tc.function.name,
    arguments: tc.function.arguments,
    call_id: tc.id,
  }));
}

// ── Request context ────────────────────────────────────────────────

export interface RequestContext {
  hasCustomTools: boolean;
  commandContext: CommandContext;
  requestTitle: boolean;
}
/** Proton reports completion_tokens; prompt_tokens is estimated from request body. */
export function toOpenAIChatUsage(
  usage?: LumoUsage,
): OpenAIChatResponse["usage"] | undefined {
  if (usage?.completion_tokens == null) return undefined;

  const promptTokens = usage.prompt_tokens ?? 0;
  return {
    prompt_tokens: promptTokens,
    completion_tokens: usage.completion_tokens,
    total_tokens: promptTokens + usage.completion_tokens,
  };
}

export { resolveInjectInto } from "../request-prep.js";

export function buildRequestContext(
  deps: EndpointDependencies,
  conversationId: ConversationId | undefined,
  tools?: OpenAITool[],
): RequestContext {
  const serverToolsConfig = getCustomToolsConfig();
  return {
    hasCustomTools: serverToolsConfig.enabled && !!tools && tools.length > 0,
    commandContext: {
      syncInitialized: deps.syncInitialized ?? false,
      conversationId,
      authManager: deps.authManager,
    },
    requestTitle: shouldRequestTitle(deps, conversationId),
  };
}

// ── Persistence helpers ────────────────────────────────────────────

/** Run the queued completion and persist title + assistant turn.
 * Shared by both OpenAI routes; emit/error shaping stays with the callers. */
export async function runCompletionAndPersist(
  deps: EndpointDependencies,
  ctx: RequestContext,
  conversationId: ConversationId | undefined,
  turns: Turn[],
  processor: {
    onChunk: (c: string) => void;
    finalize(): void;
    toolCallsEmitted: OpenAIToolCall[];
  },
  options: {
    instructions?: string;
    injectInstructionsInto?: "first" | "last";
    modelTier: LumoModelTier;
    enableReasoning: boolean;
    onReasoning?: (content: string) => void;
  },
): Promise<ChatResult> {
  turns = await withImageDescriptions(deps, turns, options);
  const result = await deps.queue.add(async () =>
    deps.lumoClient!.chatWithHistory(turns, processor.onChunk, {
      requestTitle: ctx.requestTitle,
      instructions: options.instructions,
      injectInstructionsInto: options.injectInstructionsInto,
      modelTier: options.modelTier,
      enableReasoning: options.enableReasoning,
      onReasoning: options.onReasoning,
      coachAnnounceWithoutTool: ctx.hasCustomTools,
      useNativeTools: !ctx.hasCustomTools,
    }),
  );

  logger.debug("[Server] Stream completed");
  processor.finalize();
  persistTitle(result, deps, conversationId);
  persistAssistantTurn(
    deps,
    conversationId,
    result.message,
    mapToolCallsForPersistence(processor.toolCallsEmitted),
  );
  getMetrics()?.lumoCompletionsTotal.inc({
    tier: options.modelTier,
    reasoning: options.enableReasoning ? "true" : "false",
  });
  return result;
}

/** One standalone Lumo completion (no title, no reasoning, native tools on). */
function oneShotLumo(
  deps: EndpointDependencies,
  modelTier: LumoModelTier,
): (turn: Turn) => Promise<string> {
  return async (turn) => {
    const result = await deps.queue.add(async () =>
      deps.lumoClient!.chatWithHistory([turn], undefined, {
        requestTitle: false,
        modelTier,
        enableReasoning: false,
        useNativeTools: true,
      }),
    );
    return result.message.content ?? "";
  };
}

/**
 * Attached images → a text description next to each (see src/vision). Lumo
 * only sees an image through describe_image, which it often skips in agent
 * mode; this makes every step see what the screenshot shows.
 */
async function withImageDescriptions(
  deps: EndpointDependencies,
  turns: Turn[],
  options: {
    modelTier: LumoModelTier;
    onReasoning?: (content: string) => void;
  },
): Promise<Turn[]> {
  if (
    !getServerConfig().describeAttachedImages ||
    !getEnableImageTools() ||
    !deps.lumoClient
  ) {
    return turns;
  }
  return describeAttachedImages(turns, {
    describe: oneShotLumo(deps, options.modelTier),
    progress: (msg) => options.onReasoning?.(`[lumo-tamer] ${msg}\n`),
  });
}

/** Persist title if Lumo generated one. No-op for stateless requests. */
export function persistTitle(
  result: ChatResult,
  deps: EndpointDependencies,
  conversationId: ConversationId | undefined,
): void {
  if (!conversationId || !result.title || !deps.conversationStore) return;
  deps.conversationStore.setTitle(conversationId, result.title); // Already processed by LumoClient
}

/**
 * Persist an assistant turn.
 *
 * When custom tool calls are present, we skip persistence entirely. The client (e.g. Home Assistant)
 * will send the assistant message back with the tool output in the next request, and
 * appendMessages() will handle it via ID-based deduplication. This avoids order mismatches
 * between what we persist and what the client sends back.
 *
 * Native tool calls (web_search, weather, etc.) are handled differently - they are executed
 * server-side by Lumo, so we persist them immediately with the tool call/result data.
 * The message data (including JSON-serialized tool call) comes from ChatResult.message.
 */
export function persistAssistantTurn(
  deps: EndpointDependencies,
  conversationId: ConversationId | undefined,
  message: AssistantMessageData,
  customToolCalls?: Array<{ name: string; arguments: string; call_id: string }>,
): void {
  if (conversationId && deps.conversationStore) {
    // Custom tool calls: skip persistence (client will send back)
    if (customToolCalls && customToolCalls.length > 0) {
      return;
    }

    // Persist message (with or without native tool data)
    deps.conversationStore.appendAssistantResponse(conversationId, message);
  } else {
    // Stateless: track metric only (no persistence)
    getMetrics()?.messagesTotal.inc({ role: "assistant" });
  }
}

// ── ID generation ─────────────────────────────────────────────────

/** Unix epoch seconds — the one clock source for API timestamps. */
export function nowEpoch(): number {
  return Math.floor(Date.now() / 1000);
}

/** Generate a response ID (`resp-xxx`). */
export function generateResponseId(): string {
  return `resp-${randomUUID()}`;
}

/** Generate an output item ID (`item-xxx`). */
export function generateItemId(): string {
  return `item-${randomUUID()}`;
}

/** Generate a function call item ID (`fc-xxx`). */
export function generateFunctionCallId(): string {
  return `fc-${randomUUID()}`;
}

/** Generate a chat completion ID (`chatcmpl-xxx`). */
export function generateChatCompletionId(): string {
  return `chatcmpl-${randomUUID()}`;
}

// ── SSE headers ───────────────────────────────────────────────────

/** Set standard SSE headers on the response. */
export function setSSEHeaders(res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
}
