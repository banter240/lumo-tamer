/**
 * Split jammed tool-call JSON: {"name":"a"...}{"name":"b"...}
 * Lumo often omits a closing brace, so objects nest. Cut at the next {"name":
 * and close missing braces.
 */

const NAME_OPEN = /^\{\s*"name"\s*:\s*"([^"]*)"/;

function isToolCallOpen(text: string, braceIndex: number, depth: number): boolean {
  const match = text.slice(braceIndex).match(NAME_OPEN);
  if (!match) return false;
  if (depth === 0) return true;
  return match[1].includes(':');
}

function findToolCallStarts(text: string): number[] {
  const starts: number[] = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') {
      if (isToolCallOpen(text, i, depth)) starts.push(i);
      depth++;
    } else if (char === '}') {
      if (depth > 0) depth--;
    }
  }
  return starts;
}

function takeBalancedObject(text: string): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) return text.slice(0, i + 1);
    }
  }
  if (depth > 0 && depth < 8) {
    const repaired = text.trimEnd() + '}'.repeat(depth);
    try {
      JSON.parse(repaired);
      return repaired;
    } catch {
      return null;
    }
  }
  return null;
}

/** JSON object strings that look like tool calls, in order. */
export function splitToolJsonObjects(text: string): string[] {
  const starts = findToolCallStarts(text);
  if (starts.length === 0) return [];

  const objects: string[] = [];
  for (let i = 0; i < starts.length; i++) {
    const from = starts[i];
    const to = i + 1 < starts.length ? starts[i + 1] : text.length;
    const window = text.slice(from, to);
    const object = takeBalancedObject(window);
    if (object) objects.push(object);
  }
  return objects;
}
