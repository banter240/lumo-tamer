/**
 * Lead agent tool allowlist: keep OpenCode orchestration tools (task / similar),
 * strip coding tools (read/write/edit/bash/glob/grep/…).
 */

import type { OpenAITool } from '../types.js';

/** Case-insensitive orchestration tool names Lead may keep. */
const ORCHESTRATION_EXACT = new Set([
  'task',
  'subagent',
  'delegate',
  'invoke',
  'call_task',
  'run_task',
]);

/**
 * True when a tool name is an orchestration / Task-style tool Lead may use.
 * Matches `task`, `Task`, `subagent`, and names with a `task` segment (task_foo / foo_task).
 */
export function isOrchestrationToolName(raw: string): boolean {
  const name = raw.trim().toLowerCase().replace(/^user:/, '');
  if (!name) return false;
  if (ORCHESTRATION_EXACT.has(name)) return true;
  // Segment match: task, foo.task, task.bar, call-task, TaskTool → tasktool no;
  // prefer underscore/dot/hyphen boundaries around "task".
  if (/(^|[._-])task($|[._-])/.test(name)) return true;
  if (name === 'tasktool' || name.startsWith('tasktool')) return true;
  return false;
}

export function toolFunctionName(tool: OpenAITool): string {
  return tool.function?.name
    || (tool as unknown as { name?: string }).name
    || '';
}

/** Keep only orchestration tools for the Lead agent; drop coding tools. */
export function filterToolsForLead(tools: OpenAITool[] | undefined): OpenAITool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  const kept = tools.filter((t) => isOrchestrationToolName(toolFunctionName(t)));
  return kept.length > 0 ? kept : undefined;
}
