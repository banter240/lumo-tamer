/**
 * Detect assistant narration that announces a tool action without emitting a tool call.
 * Used to coach/bounce the worker (and inform Lead prompts) similar to forToolBounce.
 */

import { extractToolCalls } from './extract.js';

/** Narration that usually precedes a real tool call (GLM / coding agents). */
const ANNOUNCE_PATTERNS: RegExp[] = [
  /\blet me (?:just )?(?:read|check|look|open|search|find|list|run|execute|edit|write|create|inspect|scan|grep|glob)\b/i,
  /\bi(?:'ll| will) (?:now )?(?:read|check|look|open|search|find|list|run|execute|edit|write|create|inspect)\b/i,
  /\breading (?:all |the |every )?(?:files?|dirs?|directories|code|contents?)\b/i,
  /\b(?:searching|scanning|listing|inspecting|opening|checking) (?:the |all |your )?(?:files?|code|repo|project|directory|dir)\b/i,
  /\bi(?:'m| am) (?:going to |about to )?(?:read|check|search|run|edit|write|list)\b/i,
  /\b(?:first|next)[,:]? (?:i(?:'ll| will) )?(?:read|check|search|look|run|edit)\b/i,
];

/**
 * True when `content` looks like tool-intent narration and does not contain a
 * valid tool-call JSON blob (fenced or raw).
 */
export function isAnnounceWithoutToolCall(content: string | null | undefined): boolean {
  if (!content || !content.trim()) return false;
  const toolCalls = extractToolCalls(content);
  if (toolCalls.length > 0) return false;
  const text = content.trim();
  // Ignore very long pure answers that happen to contain a phrase.
  // Announce lines are typically short preambles; still match anywhere in first ~800 chars.
  const window = text.length > 800 ? text.slice(0, 800) : text;
  return ANNOUNCE_PATTERNS.some((re) => re.test(window));
}
