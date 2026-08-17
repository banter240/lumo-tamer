/**
 * Tool call ID utilities
 *
 * - call_id format: `toolname__uuid` (embeds tool name for extraction)
 * - Text-extracted (custom) calls use `toolname__synth__uuid` so a later
 *   request can recognize them without process-local state.
 * - Completion tracking with deduplication
 * - Lumo-specific prefixing for function_call_output
 */

import { randomUUID } from 'crypto';
import { getCustomToolsConfig } from '../../app/config.js';
import { logger } from '../../app/logger.js';
import { getMetrics } from '../../app/metrics.js';

/** Marker baked into call_ids that lumo-tamer invented (not issued by Lumo). */
const SYNTHETIC_TAG = 'synth';
const SYNTHETIC_ID_RE = new RegExp(`__${SYNTHETIC_TAG}__[a-f0-9]+$`);
const CALL_ID_RE = new RegExp(`^(.+?)__(?:${SYNTHETIC_TAG}__)?([a-f0-9]+)$`);

// ── Call ID generation ────────────────────────────────────────────────

/**
 * Generate a call_id for tool calls.
 * Format: `toolname__uuid`, or `toolname__synth__uuid` when `synthetic`.
 */
export function generateCallId(toolName: string, synthetic = false): string {
  const hex = randomUUID().replace(/-/g, '').slice(0, 24);
  return synthetic ? `${toolName}__${SYNTHETIC_TAG}__${hex}` : `${toolName}__${hex}`;
}

/**
 * True when this call_id was minted by lumo-tamer for a text-extracted tool call.
 * Lumo never issued these IDs; echoing them back as function_call_output 400s.
 */
export function isSyntheticCallId(callId: string): boolean {
  return SYNTHETIC_ID_RE.test(callId);
}

/**
 * Extract tool name from call_id format: `toolname__uuid` or `toolname__synth__uuid`.
 * Returns undefined if call_id doesn't match the expected format.
 */
export function extractToolNameFromCallId(callId: string): string | undefined {
  const match = callId.match(CALL_ID_RE);
  return match?.[1];
}

/**
 * Flatten a synthetic tool result into a normal user turn.
 * Lumo has no matching native call_id, so the result must not stay
 * a function_call_output / role:tool item.
 */
export function formatSyntheticToolResult(toolName: string, output: string): string {
  return `[Tool Result: ${toolName}]\n${output}`;
}

export function formatClientToolCall(toolName: string): string {
  return `[Tool Call: ${toolName}]`;
}

/** Best-effort name from a client call_id / name field. */
export function resolveClientToolName(callId?: string, name?: string): string {
  if (name && name.trim()) return name;
  if (callId) {
    const extracted = extractToolNameFromCallId(callId);
    if (extracted) return extracted;
  }
  return 'tool';
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  return JSON.stringify(value);
}

/**
 * Lumo has no OpenAI tool protocol. Every client tool call/result must become
 * plain text before it hits Proton, regardless of call_id shape.
 *
 * OpenCode often echoes `call_…` / `fc-…` instead of our `toolname__synth__…`
 * ids. Matching only synth ids left those items intact → missing user message
 * (400) or a function_call_output JSON body Proton rejects (400) → retry loop.
 */
export function flattenClientToolItems<T>(items: T[]): T[] {
  const result: T[] = [];

  for (const item of items) {
    if (typeof item !== 'object' || item === null) {
      result.push(item);
      continue;
    }
    const obj = item as Record<string, unknown>;

    if (obj.type === 'function_call_output') {
      const name = resolveClientToolName(
        typeof obj.call_id === 'string' ? obj.call_id : undefined,
        typeof obj.name === 'string' ? obj.name : undefined,
      );
      result.push({ role: 'user', content: formatSyntheticToolResult(name, asText(obj.output)) } as T);
      continue;
    }

    if (obj.role === 'tool') {
      const name = resolveClientToolName(
        typeof obj.tool_call_id === 'string' ? obj.tool_call_id : undefined,
        typeof obj.name === 'string' ? obj.name : undefined,
      );
      result.push({ role: 'user', content: formatSyntheticToolResult(name, asText(obj.content)) } as T);
      continue;
    }

    if (obj.type === 'function_call') {
      const name = resolveClientToolName(
        typeof obj.call_id === 'string' ? obj.call_id : undefined,
        typeof obj.name === 'string' ? obj.name : undefined,
      );
      result.push({ role: 'assistant', content: formatClientToolCall(name) } as T);
      continue;
    }

    if (obj.role === 'assistant' && Array.isArray(obj.tool_calls)) {
      const calls = (obj.tool_calls as Array<{ id?: string; function?: { name?: string } }>)
        .map((tc) => formatClientToolCall(resolveClientToolName(tc.id, tc.function?.name)))
        .join('\n');
      const content = typeof obj.content === 'string' ? obj.content : '';
      const text = [content, calls].filter(Boolean).join('\n');
      if (text) result.push({ role: 'assistant', content: text } as T);
      continue;
    }

    result.push(item);
  }

  return result;
}

/** @deprecated use flattenClientToolItems */
export const sanitizeSyntheticToolItems = flattenClientToolItems;

// ── Completion tracking ───────────────────────────────────────────────

/**
 * Set of call_ids that have been tracked as completed.
 * Prevents double-counting on duplicate requests (both stateful and stateless).
 */
const completedCallIds = new Set<string>();

/**
 * Track completion of a custom tool call.
 * Extracts tool name from call_id format (toolname__uuid).
 * Deduplicates via completedCallIds Set.
 */
export function trackCustomToolCompletion(callId: string): void {
  // Text-extracted calls never went through Lumo's tool pipeline.
  if (isSyntheticCallId(callId)) return;
  if (completedCallIds.has(callId)) return;
  completedCallIds.add(callId);

  const toolName = extractToolNameFromCallId(callId);
  if (!toolName) return;

  logger.info({ toolName, call_id: callId }, 'Custom tool call completed');
  getMetrics()?.toolCallsTotal.inc({
    type: 'custom',
    status: 'completed',
    tool_name: toolName,
  });
}

// ── Lumo prefixing ────────────────────────────────────────────────────

/**
 * Add tool_name with prefix to function_call_output JSON for Lumo context.
 * Extracts tool name from call_id and re-prefixes it.
 */
export function addToolNameToFunctionOutput(content: string): string {
  try {
    const parsed = JSON.parse(content);
    if (parsed.type === 'function_call_output' && parsed.call_id) {
      const toolName = extractToolNameFromCallId(String(parsed.call_id));
      if (toolName) {
        const prefix = getCustomToolsConfig().prefix;
        const prefixedToolName = prefix ? `${prefix}${toolName}` : toolName;
        return JSON.stringify({
          ...parsed,
          tool_name: prefixedToolName,
        });
      }
    }
  } catch {
    // Not valid JSON, return as-is
  }
  return content;
}
