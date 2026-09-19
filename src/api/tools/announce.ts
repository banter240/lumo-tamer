import { extractToolCalls } from './extract.js';
import { getServerConfig } from '../../app/config.js';

function getDanglingColonThresholds() {
  const cfg = getServerConfig().customTools.recovery;
  return {
    maxTotal: cfg.danglingColonMaxLength,
    maxLastLine: cfg.danglingColonLastLineMaxLength,
  };
}

/** True when the reply starts a sentence and dies on a trailing colon. */
export function endsWithDanglingColon(content: string): boolean {
  const text = content.trim();
  if (!text) return false;
  if (text.length > getDanglingColonThresholds().maxTotal) return false;
  if (/https?:$/i.test(text)) return false;
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const last = lines[lines.length - 1] ?? '';
  if (last.length > getDanglingColonThresholds().maxLastLine) return false;
  return /\S:\s*$/.test(last);
}

/** True when the bounceDanglingColon flag is on and the reply announces without emitting a JSON block. */
export function isAnnounceWithoutToolCall(content: string | null | undefined): boolean {
  if (!getServerConfig().customTools.recovery.bounceDanglingColon) return false;
  if (!content || !content.trim()) return false;
  if (extractToolCalls(content).length > 0) return false;
  return endsWithDanglingColon(content);
}

/** True when blank-reply bouncing is on and the response has no message text (thinking-only). */
export function isBounceableBlankReply(content: string | null | undefined): boolean {
  if (!getServerConfig().customTools.recovery.bounceBlankReply) return false;
  return !content || !content.trim();
}

/**
 * True when the reply narrates a tool call in prose (e.g. "[Assistant tool call]:")
 * instead of emitting the JSON code block. Respects the bounceNarration config flag.
 */
export function isToolCallNarration(content: string | null | undefined): boolean {
  if (!content || !content.trim()) return false;
  if (!getServerConfig().customTools.recovery.bounceNarration) return false;
  if (extractToolCalls(content).length > 0) return false;
  const text = content;
  return /\[?assistant tool call\]?\s*:/i.test(text) || /(^|\n)\s*tool call\s*:/i.test(text);
}
