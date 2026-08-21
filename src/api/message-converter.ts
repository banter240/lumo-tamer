/**
 * Converts OpenAI message formats to MessageForStore format.
 *
 * MessageForStore is compatible with Lumo's Turn type (role + content)
 * but also includes an optional `id` field for deduplication of tool messages.
 */

import type { OpenAIChatMessage, OpenAIResponseMessage, OpenAIToolCall } from './types.js';
import { Role } from '../lumo-client/index.js';
import {
  addToolNameToFunctionOutput,
  formatClientToolCall,
  formatSyntheticToolResult,
  resolveClientToolName,
} from './tools/call-id.js';
import { type MessageForStore } from 'src/conversations/types.js';

/**
 * Extract text from OpenAI-compatible content shapes.
 * Supports:
 * - string
 * - [{ type: 'text', text: '...' }]
 * - [{ text: '...' }]
 * - { text: '...' }
 */
function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content;

  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const item of content) {
      if (typeof item === 'string') {
        parts.push(item);
        continue;
      }
      if (typeof item === 'object' && item !== null) {
        const obj = item as Record<string, unknown>;
        if (typeof obj.text === 'string') {
          parts.push(obj.text);
        }
      }
    }
    return parts.join('\n').trim();
  }

  if (typeof content === 'object' && content !== null) {
    const obj = content as Record<string, unknown>;
    if (typeof obj.text === 'string') return obj.text;
  }

  return '';
}

/**
 * Convert tool-related message formats to MessageForStore.
 *
 * Handles both Chat Completions (role: 'tool', tool_calls) and
 * Responses API (function_call, function_call_output) formats.
 *
 * Tool-related items are converted to user/assistant roles with JSON content,
 * since Lumo's tool_call/tool_result roles are reserved for SSE tools.
 *
 * @returns Converted message(s), or null if item is not a tool message
 */
export function convertToolMessage(item: unknown): MessageForStore | MessageForStore[] | null {
  if (typeof item !== 'object' || item === null) return null;
  const obj = item as Record<string, unknown>;

  // Chat Completions: role: 'tool' -> user text (never a Lumo tool-result role)
  if (obj.role === 'tool' && 'tool_call_id' in obj) {
    const callId = String(obj.tool_call_id);
    const name = resolveClientToolName(callId, typeof obj.name === 'string' ? obj.name : undefined);
    const output = typeof obj.content === 'string' ? obj.content : JSON.stringify(obj.content ?? '');
    return { role: Role.User, content: formatSyntheticToolResult(name, output), id: callId };
  }

  // Chat Completions: assistant with tool_calls -> short text, no fake call_id
  if (obj.role === 'assistant' && 'tool_calls' in obj && Array.isArray(obj.tool_calls)) {
    const toolCalls = obj.tool_calls as OpenAIToolCall[];
    if (toolCalls.length === 0) return [];
    const text = [
      typeof obj.content === 'string' ? obj.content : '',
      ...toolCalls.map((tc) => formatClientToolCall(
        resolveClientToolName(tc.id, tc.function?.name),
        tc.function?.arguments,
      )),
    ].filter(Boolean).join('\n');
    return { role: Role.Assistant, content: text };
  }

  // Responses API: function_call -> assistant text (name + args, no call_id)
  if (obj.type === 'function_call') {
    const name = resolveClientToolName(
      typeof obj.call_id === 'string' ? obj.call_id : undefined,
      typeof obj.name === 'string' ? obj.name : undefined,
    );
    return { role: Role.Assistant, content: formatClientToolCall(name, obj.arguments) };
  }

  // Responses API: function_call_output -> user text
  if (obj.type === 'function_call_output') {
    const callId = String(obj.call_id ?? '');
    const name = resolveClientToolName(callId, typeof obj.name === 'string' ? obj.name : undefined);
    const output = typeof obj.output === 'string' ? obj.output : JSON.stringify(obj.output ?? '');
    return { role: Role.User, content: formatSyntheticToolResult(name, output), id: callId };
  }

  return null;
}

/**
 * Extract system/developer message content from a ChatMessage array.
 * Exported for routes to build instructions.
 */
export function extractSystemMessage(messages: OpenAIChatMessage[]): string | undefined {
  const systemMsg = messages.find(m =>
    m.role === 'system' || (m.role as string) === 'developer'
  );
  if (systemMsg && 'content' in systemMsg) {
    const content = extractTextContent(systemMsg.content);
    return content || undefined;
  }
  return undefined;
}


/**
 * Convert OpenAI ChatMessage[] to MessageForStore[].
 *
 * Handles tool-related messages:
 * - role: 'tool' -> user message with JSON content
 * - assistant with tool_calls -> assistant message(s) with JSON content
 *
 * Preserves semantic IDs (call_id) for tool messages to enable deduplication.
 */
export async function convertOpenAIChatMessages(messages: OpenAIChatMessage[]): Promise<MessageForStore[]> {
  const result: MessageForStore[] = [];

  for (const msg of messages) {
    // Skip system/developer messages - they're handled via instructions parameter
    if (msg.role === 'system' || (msg.role as string) === 'developer') {
      continue;
    }

    // Handle tool-related messages via convertToolMessage
    const converted = convertToolMessage(msg);
    if (converted) {
      const convertedArray = Array.isArray(converted) ? converted : [converted];
      for (const item of convertedArray) {
        // For function_call_output, add prefixed tool_name for Lumo context
        const content = item.role === Role.User
          ? addToolNameToFunctionOutput(item.content ?? '')
          : item.content;
        result.push({ role: item.role, content, id: item.id });
      }
      continue;
    }

    const text = extractTextContent('content' in msg ? msg.content : undefined);
    result.push({
      role: msg.role === 'user' ? Role.User : Role.Assistant,
      content: text,
    });
  }

  return result;
}

/**
 * Convert OpenAI Responses API input to MessageForStore[].
 *
 * Handles both string input and message array input.
 * Preserves semantic IDs for tool messages to enable deduplication.
 */
export async function convertOpenAIResponseMessages(
  input: string | OpenAIResponseMessage[] | undefined,
  requestInstructions?: string
): Promise<MessageForStore[]> {
  if (!input) {
    return [];
  }

  // Simple string input
  if (typeof input === 'string') {
    return [{ role: Role.User, content: input }];
  }

  // Array of messages -> ChatMessage[]
  // - function_call -> assistant turn with tool call JSON
  // - function_call_output -> user turn with JSON (via convertToolMessage in convertChatMessages)
  // - regular messages -> passed through
  const chatMessages: OpenAIChatMessage[] = [];
  for (const item of input) {
    if (typeof item !== 'object') continue;
    const itemType = 'type' in item ? (item as { type: string }).type : undefined;
    if (itemType === 'function_call') {
      const fc = item as unknown as { name: string; arguments?: unknown; call_id?: string };
      chatMessages.push({
        role: 'assistant',
        content: formatClientToolCall(resolveClientToolName(fc.call_id, fc.name), fc.arguments),
      });
      continue;
    }
    // function_call_output will be handled by convertToolMessage in convertChatMessages
    if (itemType === 'function_call_output') {
      // Pass through as-is - convertChatMessages will normalize it
      chatMessages.push(item as unknown as OpenAIChatMessage);
      continue;
    }
    if ('role' in item && 'content' in item) {
      const obj = item as { role: string; content: unknown };
      chatMessages.push({
        role: obj.role as 'user' | 'assistant' | 'system',
        content: obj.content as string,
      });
    }
  }

  // If request instructions provided and no system message exists, add one
  if (requestInstructions && !chatMessages.some(m => m.role === 'system')) {
    chatMessages.unshift({ role: 'system', content: requestInstructions });
  }

  return convertOpenAIChatMessages(chatMessages);
}
