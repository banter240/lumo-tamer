/**
 * API-specific instruction processing utilities
 *
 * - Template validation
 * - Replace patterns for cleaning client instructions
 * - Instruction building with tool prefixing
 * - Lead profile (chat orchestrator; orchestration tools only)
 */

import { logger } from '../app/logger.js';
import { getServerInstructionsConfig, getCustomToolsConfig, getLeadAgentProfile } from '../app/config.js';
import { interpolateTemplate } from '../app/template.js';
import { applyToolPrefix, applyToolNamePrefix } from './tools/prefix.js';
import type { OpenAITool } from './types.js';

// ── Template validation ───────────────────────────────────────────────

/**
 * Important template variables that should be present for full functionality.
 * Each has a warning message explaining the consequence of omission.
 */
const TEMPLATE_VARIABLE_WARNINGS: Record<string, string> = {
  clientInstructions: 'Instructions provided by API client will not be forwarded',
  tools: 'Tool definitions will not be included in instructions',
  fallback: 'No fallback instructions when client provides no system message',
};

let templateValidated = false;

/**
 * Validate template contains important variables. Warns once on first use.
 * Also validates replace patterns (server-only).
 */
export function validateTemplateOnce(template: string): void {
  if (templateValidated) return;
  templateValidated = true;

  for (const [varName, warning] of Object.entries(TEMPLATE_VARIABLE_WARNINGS)) {
    // Check for {{varName}}
    const pattern = new RegExp(`\\{\\{${varName}\\}\\}`);
    if (!pattern.test(template)) {
      logger.warn(`Template missing {{${varName}}}. ${warning}`);
    }
  }

  // Also validate replace patterns (only used in server mode)
  validateReplacePatternsOnce();
}

// ── Replace patterns ──────────────────────────────────────────────────

export interface ReplacePattern {
  pattern: string;
  replacement?: string;
}

/**
 * Apply replace patterns to text (case-insensitive regex).
 * Each pattern can have an optional replacement; if omitted, matches are stripped.
 */
export function applyReplacePatterns(text: string, patterns: ReplacePattern[]): string {
  if (!patterns || patterns.length === 0) return text;
  let result = text;
  for (const { pattern, replacement } of patterns) {
    try {
      const regex = new RegExp(pattern, 'gi');
      result = result.replace(regex, replacement ?? '');
    } catch {
      // Invalid regex pattern - skip it (already warned at config load)
    }
  }
  // Clean up multiple consecutive newlines/spaces left by removals
  return result.replace(/\n{3,}/g, '\n\n').replace(/  +/g, ' ').trim();
}

// ── Replace patterns validation ───────────────────────────────────────

let replacePatternsValidated = false;

/**
 * Validate replace patterns are valid regex. Warns once on first use.
 * Called from validateTemplateOnce (server-only).
 */
function validateReplacePatternsOnce(): void {
  if (replacePatternsValidated) return;
  replacePatternsValidated = true;

  const patterns = getServerInstructionsConfig().replacePatterns ?? [];
  for (const { pattern } of patterns) {
    try {
      new RegExp(pattern, 'gi');
    } catch (e) {
      logger.warn({ error: e, pattern }, `Ignoring "${pattern}" in instructions.replacePatterns`);
    }
  }
}

// ── Shared helpers ────────────────────────────────────────────────────

/**
 * Extract tool names from tool definitions (handles both nested and flat formats).
 */
function extractToolNames(tools?: OpenAITool[]): string[] {
  if (!tools) return [];
  return tools
    .map(t => t.function?.name || (t as unknown as { name?: string }).name)
    .filter((n): n is string => Boolean(n));
}

function cleanClientInstructions(
  clientInstructions: string | undefined,
  patterns: ReplacePattern[],
): string | undefined {
  if (!clientInstructions) return undefined;
  return applyReplacePatterns(clientInstructions, patterns);
}

/**
 * Interpolate a profile template with client instructions / fallback.
 * Shared by worker and lead so Handlebars logic stays in one place.
 */
export function interpolateInstructionProfile(
  template: string,
  vars: {
    clientInstructions?: string;
    fallback: string;
    prefix?: string;
    tools?: string;
    forTools?: string;
    forOrchestrationTools?: string;
  },
): string {
  return interpolateTemplate(template, vars);
}

// ── Instruction building ─────────────────────────────────────────────

export type InstructionProfile = 'lead' | 'worker';

/**
 * Build lead-agent instructions.
 * May include allowlisted orchestration tools + slim forOrchestrationTools —
 * never the coding forTools MITM dump.
 */
export function buildLeadInstructions(
  clientInstructions?: string,
  tools?: OpenAITool[],
): string {
  const profile = getLeadAgentProfile();
  const toolsConfig = getCustomToolsConfig();
  const { prefix } = toolsConfig;
  const cleaned = cleanClientInstructions(clientInstructions, profile.replacePatterns ?? []);
  const includeTools = toolsConfig.enabled && tools && tools.length > 0;
  const forOrchestrationTools = includeTools
    ? interpolateTemplate(profile.forOrchestrationTools, { prefix })
    : undefined;
  let toolsJson: string | undefined;
  if (includeTools && tools) {
    toolsJson = JSON.stringify(applyToolPrefix(tools, prefix), null, 2);
  }
  return interpolateInstructionProfile(profile.template, {
    clientInstructions: cleaned,
    fallback: profile.fallback,
    prefix,
    tools: toolsJson,
    forOrchestrationTools,
  });
}

/**
 * Build instructions using the template system.
 * Uses conditionals in the template to handle all cases:
 * - With/without tools
 * - With/without client instructions (falls back to fallback)
 *
 * @param tools - Optional array of OpenAI tool definitions
 * @param clientInstructions - Optional instructions from client (system/developer message)
 * @returns Formatted instruction string
 */
export function buildInstructions(
  tools?: OpenAITool[],
  clientInstructions?: string,
  options: { compact?: boolean; profile?: InstructionProfile } = {},
): string {
  if (options.profile === 'lead') {
    return buildLeadInstructions(clientInstructions, tools);
  }

  const instructionsConfig = getServerInstructionsConfig();
  const toolsConfig = getCustomToolsConfig();
  const { prefix } = toolsConfig;
  const { replacePatterns } = instructionsConfig;
  const compact = options.compact === true;

  // Determine if we should include tools
  const includeTools = toolsConfig.enabled && tools && tools.length > 0;

  // Full protocol on the first user turn; a short reminder after that.
  const forTools = interpolateTemplate(
    compact ? instructionsConfig.forToolsCompact : instructionsConfig.forTools,
    { prefix },
  );

  let toolsJson: string | undefined;
  if (includeTools && tools) {
    // Always send full tool schemas. compact only shortens the protocol wrapper.
    toolsJson = JSON.stringify(applyToolPrefix(tools, prefix), null, 2);
  }

  // Clean and prefix client instructions
  let cleanedClientInstructions: string | undefined;
  if (clientInstructions) {
    cleanedClientInstructions = applyReplacePatterns(clientInstructions, replacePatterns);
    if (includeTools) {
      const toolNames = extractToolNames(tools);
      cleanedClientInstructions = applyToolNamePrefix(cleanedClientInstructions, toolNames, prefix);
    }
  }

  // Interpolate main template with all variables
  return interpolateInstructionProfile(instructionsConfig.template, {
    prefix,
    tools: toolsJson,
    clientInstructions: cleanedClientInstructions,
    forTools,
    fallback: instructionsConfig.fallback,
  });
}
