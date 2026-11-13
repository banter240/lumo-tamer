/**
 * Tool prefix helpers
 *
 * Utilities for prefixing/stripping custom tool names.
 */

import type { OpenAITool } from '../types.js';

// ── Prefix helpers ───────────────────────────────────────────────────

/**
 * Apply prefix to tool names in tool definitions.
 * Returns a new array with prefixed tool names.
 */
export function applyToolPrefix(tools: OpenAITool[], prefix: string): OpenAITool[] {
  if (!prefix || !tools) return tools;
  return tools.map(tool => {
    // Handle nested format: { type: "function", function: { name: "..." } }
    if (tool?.function?.name) {
      return {
        ...tool,
        function: {
          ...tool.function,
          name: `${prefix}${tool.function.name}`,
        },
      };
    }
    // Handle flat format: { type: "function", name: "..." } (e.g., Home Assistant)
    const flat = tool as unknown as { name?: string };
    if (flat?.name) {
      return { ...tool, name: `${prefix}${flat.name}` } as unknown as OpenAITool;
    }
    return tool;
  });
}

/**
 * Strip prefix from a tool name.
 * If the name doesn't have the prefix, returns it unchanged.
 */
export function stripToolPrefix(name: string, prefix: string): string {
  if (!prefix) return name;
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

/**
 * Collect unprefixed tool names from a client request's `tools` array.
 * Accepts both nested `{ function: { name } }` and flat `{ name }` shapes.
 */
export function extractClientToolNames(tools?: OpenAITool[]): string[] {
  if (!tools || tools.length === 0) return [];
  const names: string[] = [];
  for (const tool of tools) {
    if (tool?.function?.name) {
      names.push(tool.function.name);
      continue;
    }
    const flat = tool as unknown as { name?: string };
    if (flat?.name) names.push(flat.name);
  }
  return names;
}

/** Parameter names of one client tool, used to recognise argument-only JSON. */
export interface ToolSignature {
  name: string;
  required: string[];
  properties: string[];
}

/** Parameter signatures of the client tools (nested or flat shapes). */
export function extractClientToolSignatures(tools?: OpenAITool[]): ToolSignature[] {
  if (!tools || tools.length === 0) return [];
  const out: ToolSignature[] = [];
  for (const tool of tools) {
    const flat = tool as unknown as { name?: string; parameters?: unknown };
    const name = tool?.function?.name ?? flat?.name;
    const params = (tool?.function?.parameters ?? flat?.parameters) as
      | { properties?: Record<string, unknown>; required?: unknown }
      | undefined;
    if (!name || !params || typeof params !== 'object') continue;
    const properties = Object.keys(params.properties ?? {});
    const required = Array.isArray(params.required)
      ? params.required.filter((p): p is string => typeof p === 'string')
      : [];
    if (properties.length === 0) continue;
    out.push({ name, required, properties });
  }
  return out;
}

/**
 * The one tool whose parameters match an argument-only object: every
 * required parameter present, no key outside its properties. Several
 * matches are narrowed to the one requiring the most parameters; a tie
 * is ambiguous and returns null.
 */
export function inferToolFromArguments(
  args: Record<string, unknown>,
  signatures: ToolSignature[],
): string | null {
  const keys = Object.keys(args);
  if (keys.length === 0) return null;
  const fits = signatures.filter(
    (s) =>
      s.required.length > 0 &&
      s.required.every((r) => keys.includes(r)) &&
      keys.every((k) => s.properties.includes(k)),
  );
  if (fits.length === 0) return null;
  const best = Math.max(...fits.map((s) => s.required.length));
  const top = fits.filter((s) => s.required.length === best);
  return top.length === 1 ? top[0].name : null;
}

// ── Regex helpers ────────────────────────────────────────────────────

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Apply prefix to tool names appearing in text.
 * Only prefixes tool names that match the provided list exactly (word boundaries).
 * Skips names that are already prefixed.
 */
export function applyToolNamePrefix(
  text: string,
  toolNames: string[],
  prefix: string
): string {
  if (!prefix || !text || !toolNames || toolNames.length === 0) return text;

  let result = text;
  for (const name of toolNames) {
    // Match tool name at word boundaries, skip if already prefixed.
    // Also skip matches followed by ':' or '-': property keys (pricing: read)
    // and compounds (read-only) are prose, not tool references.
    const regex = new RegExp(`(?<!${escapeRegex(prefix)})\\b${escapeRegex(name)}\\b(?![:-])`, 'g');
    result = result.replace(regex, `${prefix}${name}`);
  }
  return result;
}


