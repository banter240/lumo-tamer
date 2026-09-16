import { extractToolCalls } from './extract.js';

/** True when the reply starts a sentence and dies on a trailing colon. */
export function endsWithDanglingColon(content: string): boolean {
  const text = content.trim();
  if (!text || text.length > 600) return false;
  if (/https?:$/i.test(text)) return false;
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const last = lines[lines.length - 1] ?? '';
  if (last.length > 200) return false;
  return /\S:\s*$/.test(last);
}

export function isAnnounceWithoutToolCall(content: string | null | undefined): boolean {
  if (!content || !content.trim()) return false;
  if (extractToolCalls(content).length > 0) return false;
  return endsWithDanglingColon(content);
}
