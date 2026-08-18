/**
 * Lumo emits chat text. The OpenAI tool protocol is {name, arguments}.
 * Strict JSON.parse first; if Lumo broke escaping, recover keys anyway.
 */

import type { ParsedToolCall } from './types.js';
import { isToolCallJson, parseToolCallJson } from './types.js';
import { splitToolJsonObjects } from './tool-json-split.js';

function skipWs(text: string, index: number): number {
  while (index < text.length && /\s/.test(text[index])) index++;
  return index;
}

/** Fence wrappers and a leading language tag around a tool-call blob. */
export function stripFenceNoise(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/^json\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

/** Trailing `json` language tags / incomplete backticks before a tool call. Not chat text. */
export function stripTrailingFenceJunk(text: string): string {
  return text
    .replace(/(?:(?:^|\n)`{0,2}json[ \t]*)+\r?\n?$/i, (match) => (match.startsWith('\n') ? '\n' : ''))
    .replace(/`{2}(?:json)?[ \t]*\r?\n?$/i, '');
}

/** String value: end at a quote that is followed by , } or ]. Inner quotes stay content. */
function parseLenientString(text: string, start: number): { value: string; end: number } | null {
  if (text[start] !== '"') return null;
  let index = start + 1;
  let value = '';
  while (index < text.length) {
    const char = text[index];
    if (char === '\\' && index + 1 < text.length) {
      value += text[index + 1];
      index += 2;
      continue;
    }
    if (char === '"') {
      const after = skipWs(text, index + 1);
      const next = text[after];
      if (next === ',' || next === '}' || next === ']' || next === ':' || after >= text.length) {
        return { value, end: index + 1 };
      }
      value += char;
      index++;
      continue;
    }
    value += char;
    index++;
  }
  return { value, end: text.length };
}

function parseLenientArray(text: string, start: number): { value: unknown[]; end: number } | null {
  if (text[start] !== '[') return null;
  const items: unknown[] = [];
  let index = skipWs(text, start + 1);
  while (index < text.length && text[index] !== ']') {
    const parsed = parseLenientValue(text, index);
    if (!parsed) break;
    items.push(parsed.value);
    index = skipWs(text, parsed.end);
    if (text[index] === ',') index = skipWs(text, index + 1);
  }
  if (text[index] === ']') index++;
  return { value: items, end: index };
}

function parseLenientObject(text: string, start: number): { value: Record<string, unknown>; end: number } | null {
  if (text[start] !== '{') return null;
  const object: Record<string, unknown> = {};
  let index = skipWs(text, start + 1);
  while (index < text.length && text[index] !== '}') {
    if (text[index] !== '"') break;
    const key = parseLenientString(text, index);
    if (!key) break;
    index = skipWs(text, key.end);
    if (text[index] !== ':') break;
    index = skipWs(text, index + 1);
    const parsed = parseLenientValue(text, index);
    if (!parsed) break;
    object[key.value] = parsed.value;
    index = skipWs(text, parsed.end);
    if (text[index] === ',') index = skipWs(text, index + 1);
  }
  if (text[index] === '}') index++;
  return { value: object, end: index };
}

function parseLenientValue(
  text: string,
  start: number,
): { value: unknown; end: number } | null {
  const index = skipWs(text, start);
  if (index >= text.length) return null;
  const char = text[index];
  if (char === '"') return parseLenientString(text, index);
  if (char === '{') return parseLenientObject(text, index);
  if (char === '[') return parseLenientArray(text, index);
  if (text.startsWith('true', index)) return { value: true, end: index + 4 };
  if (text.startsWith('false', index)) return { value: false, end: index + 5 };
  if (text.startsWith('null', index)) return { value: null, end: index + 4 };
  const number = text.slice(index).match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/);
  if (number) return { value: Number(number[0]), end: index + number[0].length };
  return null;
}

function fromStrictJson(text: string): ParsedToolCall | null {
  try {
    const parsed = JSON.parse(stripFenceNoise(text)) as unknown;
    if (!isToolCallJson(parsed)) return null;
    return parseToolCallJson(parsed);
  } catch {
    return null;
  }
}

function fromLenientObject(text: string): ParsedToolCall | null {
  const cleaned = stripFenceNoise(text);
  const start = cleaned.search(/\{\s*"name"\s*:/);
  if (start < 0) return null;
  const parsed = parseLenientObject(cleaned, start);
  if (!parsed) return null;
  if (!isToolCallJson(parsed.value)) return null;
  return parseToolCallJson(parsed.value);
}

/** One Lumo blob → one tool call, or null. */
export function extractOneToolCall(text: string): ParsedToolCall | null {
  return fromStrictJson(text) ?? fromLenientObject(text);
}

/** Locate every {"name": blob (including jammed objects) and extract calls. */
export function extractToolCalls(text: string): ParsedToolCall[] {
  const cleaned = stripFenceNoise(text);
  const blobs = splitToolJsonObjects(cleaned);
  const windows = blobs.length > 0 ? blobs : [cleaned];
  const calls: ParsedToolCall[] = [];
  for (const window of windows) {
    const call = extractOneToolCall(window);
    if (call) calls.push(call);
  }
  return calls;
}
