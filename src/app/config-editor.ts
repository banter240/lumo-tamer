/**
 * Web config editor helpers.
 * Walk defaults into form fields, apply path edits, never expose secrets.
 * Field copy lives in config-editor-copy.ts.
 */

import { isMap, type Document } from 'yaml';
import {
  SECRET_PATHS,
  fieldCopy,
  fieldCategory,
  humanLabel,
  choicesFor,
  FIELD_DEPENDENCIES,
  type ConfigExample,
} from './config-editor-copy.js';

export {
  SECRET_PATHS,
  CONFIG_CATEGORIES,
  fieldCategory,
  labelFor,
  hintFor,
  moreFor,
  exampleFor,
  choicesFor,
  FIELD_DEPENDENCIES,
  type ConfigExample,
  type ConfigCategory,
  type FieldDependency,
} from './config-editor-copy.js';

const MULTILINE_KEYS = new Set([
  'template',
  'forTools',
  'forToolsCompact',
  'forToolBounce',
  'forLocalActions',
  'fallback',
  'forJsonFormat',
  'forToolRequired',
  'forToolNamed',
  'userAgent',
]);

export type ConfigFieldKind =
  | 'boolean' | 'number' | 'string' | 'multiline' | 'json' | 'secret' | 'choice' | 'stringList';

export interface ConfigField {
  path: string;
  kind: ConfigFieldKind;
  defaultValue: unknown;
  value: unknown;
  overridden: boolean;
  category: string;
  label: string;
  hint: string;
  more?: string;
  examples?: ConfigExample[];
  choices?: string[];
  dependsOn?: string;
  noDefault?: boolean;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getAt(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of splitPath(path)) {
    if (!isPlainObject(cur) || !(part in cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

export function splitPath(path: string): string[] {
  if (!path || path.includes('..') || path.startsWith('.') || path.endsWith('.')) {
    throw new Error(`Invalid config path: ${path}`);
  }
  return path.split('.');
}

export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function fieldKind(path: string, defaultValue: unknown, copy = fieldCopy(path)): ConfigFieldKind {
  if (copy.kind) return copy.kind;
  if (copy.choices?.length) return 'choice';
  if (typeof defaultValue === 'boolean') return 'boolean';
  if (typeof defaultValue === 'number') return 'number';
  if (isStringArray(defaultValue)) return 'stringList';
  if (typeof defaultValue === 'string') {
    const leaf = path.split('.').pop() ?? '';
    if (MULTILINE_KEYS.has(leaf) || defaultValue.includes('\n')) return 'multiline';
    return 'string';
  }
  return 'json';
}

export function walkConfigFields(
  defaults: Record<string, unknown>,
  user: Record<string, unknown>,
): ConfigField[] {
  const fields: ConfigField[] = [];

  function walk(node: unknown, prefix: string): void {
    if (isPlainObject(node)) {
      for (const [key, child] of Object.entries(node)) {
        walk(child, prefix ? `${prefix}.${key}` : key);
      }
      return;
    }
    const defaultValue = node;
    const current = getAt(user, prefix);
    const overridden = current !== undefined && !sameValue(current, defaultValue);
    const copy = fieldCopy(prefix);
    const kind = fieldKind(prefix, defaultValue, copy);
    
    // Check if this field has a parent dependency
    const parentDependsOn = FIELD_DEPENDENCIES[prefix]?.parent;
    const noDefault = copy.noDefault ?? false;

    fields.push({
      path: prefix,
      kind,
      defaultValue: kind === 'secret' ? null : defaultValue,
      value: kind === 'secret' ? null : (overridden ? current : defaultValue),
      overridden,
      category: fieldCategory(prefix),
      label: copy.label ?? humanLabel(prefix),
      hint: copy.hint ?? 'See config.defaults.yaml and docs/config.md.',
      ...(copy.more ? { more: copy.more } : {}),
      ...(copy.examples?.length ? { examples: copy.examples } : {}),
      ...(copy.choices ? { choices: copy.choices } : {}),
      ...(parentDependsOn ? { dependsOn: parentDependsOn } : {}),
      ...(noDefault ? { noDefault: true } : {}),
    });
  }

  walk(defaults, '');
  return fields;
}

export function redactSecrets<T>(value: T): T {
  return redactAt(value, '') as T;
}

function redactAt(value: unknown, path: string): unknown {
  if (SECRET_PATHS.has(path)) return null;
  if (Array.isArray(value)) return value.map((item, i) => redactAt(item, `${path}.${i}`));
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = redactAt(child, path ? `${path}.${key}` : key);
  }
  return out;
}

export function setAt(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = splitPath(path);
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const next = cur[part];
    if (!isPlainObject(next)) {
      cur[part] = {};
    }
    cur = cur[part] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

export function deleteAt(obj: Record<string, unknown>, path: string): void {
  const parts = splitPath(path);
  const stack: Array<{ parent: Record<string, unknown>; key: string }> = [];
  let cur: unknown = obj;
  for (const part of parts) {
    if (!isPlainObject(cur) || !(part in cur)) return;
    stack.push({ parent: cur, key: part });
    cur = cur[part];
  }
  const leaf = stack[stack.length - 1];
  delete leaf.parent[leaf.key];
  for (let i = stack.length - 2; i >= 0; i--) {
    const { parent, key } = stack[i];
    const child = parent[key];
    if (isPlainObject(child) && Object.keys(child).length === 0) {
      delete parent[key];
    }
  }
}

export interface ConfigEdits {
  changes?: Record<string, unknown>;
  resets?: string[];
}

export function resetAllEdits(defaults: Record<string, unknown>): ConfigEdits {
  return {
    changes: {},
    resets: walkConfigFields(defaults, {})
      .map((field) => field.path)
      .filter((path) => !SECRET_PATHS.has(path)),
  };
}

type FieldChange =
  | { path: string; kind: 'skip' }
  | { path: string; kind: 'delete' }
  | { path: string; kind: 'set'; value: unknown };

function planEdits(defaults: Record<string, unknown>, edits: ConfigEdits): {
  resets: string[];
  changes: FieldChange[];
} {
  const known = new Set(walkConfigFields(defaults, {}).map((field) => field.path));
  const resets: string[] = [];
  for (const path of edits.resets ?? []) {
    if (!known.has(path)) throw new Error(`Unknown config path: ${path}`);
    resets.push(path);
  }
  const changes: FieldChange[] = [];
  for (const [path, raw] of Object.entries(edits.changes ?? {})) {
    if (!known.has(path)) throw new Error(`Unknown config path: ${path}`);
    if (SECRET_PATHS.has(path) && (raw === null || raw === undefined || raw === '')) {
      changes.push({ path, kind: 'skip' });
      continue;
    }
    const defaultValue = getAt(defaults, path);
    const value = coerceFieldValue(path, defaultValue, raw);
    changes.push(sameValue(value, defaultValue)
      ? { path, kind: 'delete' }
      : { path, kind: 'set', value });
  }
  return { resets, changes };
}

export function applyConfigEdits(
  user: Record<string, unknown>,
  defaults: Record<string, unknown>,
  edits: ConfigEdits,
): Record<string, unknown> {
  const { resets, changes } = planEdits(defaults, edits);
  const next = structuredClone(user);
  for (const path of resets) deleteAt(next, path);
  for (const change of changes) {
    if (change.kind === 'skip') continue;
    if (change.kind === 'delete') deleteAt(next, change.path);
    else setAt(next, change.path, change.value);
  }
  return next;
}

export function parseStringList(path: string, raw: string): string[] {
  if (path.includes('.executors.')) {
    return raw.trim().split(/\s+/).filter(Boolean);
  }
  return raw.split(',').map((item) => item.trim()).filter(Boolean);
}

export function formatStringList(path: string, value: unknown): string {
  if (!Array.isArray(value)) return '';
  return path.includes('.executors.') ? value.join(' ') : value.join(', ');
}

export function coerceFieldValue(path: string, defaultValue: unknown, raw: unknown): unknown {
  const kind = fieldKind(path, defaultValue);
  if (kind === 'boolean') {
    if (typeof raw === 'boolean') return raw;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    throw new Error(`${path} must be a boolean`);
  }
  if (kind === 'number') {
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(n)) throw new Error(`${path} must be a number`);
    return n;
  }
  if (kind === 'stringList') {
    if (Array.isArray(raw)) return raw.map((item) => String(item));
    if (typeof raw !== 'string') throw new Error(`${path} must be a list of strings`);
    return parseStringList(path, raw);
  }
  if (kind === 'choice') {
    if (typeof raw !== 'string') throw new Error(`${path} must be a string`);
    const allowed = choicesFor(path) ?? [];
    if (!allowed.includes(raw)) throw new Error(`${path} must be one of: ${allowed.join(', ')}`);
    return raw;
  }
  if (kind === 'json') {
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw);
      } catch {
        throw new Error(`${path} must be valid JSON`);
      }
    }
    return raw;
  }
  if (typeof raw !== 'string') {
    if (typeof defaultValue === 'string' && raw != null) return String(raw);
    throw new Error(`${path} must be a string`);
  }
  return raw;
}

export function applyEditsToDocument(
  doc: Document,
  defaults: Record<string, unknown>,
  edits: ConfigEdits,
): void {
  if (!isMap(doc.contents)) {
    doc.contents = doc.createNode({});
  }

  const { resets, changes } = planEdits(defaults, edits);
  for (const path of resets) deletePathIfPresent(doc, splitPath(path));
  for (const change of changes) {
    if (change.kind === 'skip') continue;
    const parts = splitPath(change.path);
    if (change.kind === 'delete') {
      deletePathIfPresent(doc, parts);
    } else {
      ensureMapPath(doc, parts);
      doc.setIn(parts, change.value);
    }
  }
}

function hasMapPath(doc: Document, parts: string[]): boolean {
  let node: unknown = doc.contents;
  for (const part of parts) {
    if (!isMap(node) || !node.has(part)) return false;
    node = node.get(part, true);
  }
  return true;
}

function deletePathIfPresent(doc: Document, parts: string[]): void {
  if (!hasMapPath(doc, parts)) return;
  doc.deleteIn(parts);
  pruneEmptyMaps(doc, parts.slice(0, -1));
}

function ensureMapPath(doc: Document, parts: string[]): void {
  for (let i = 0; i < parts.length - 1; i++) {
    const prefix = parts.slice(0, i + 1);
    const node = doc.getIn(prefix, true);
    if (!node || !isMap(node)) {
      doc.setIn(prefix, doc.createNode({}));
    }
  }
}

function pruneEmptyMaps(doc: Document, parts: string[]): void {
  for (let i = parts.length; i > 0; i--) {
    const prefix = parts.slice(0, i);
    const node = doc.getIn(prefix, true);
    if (!node || !isMap(node) || node.items.length > 0) return;
    doc.deleteIn(prefix);
  }
}
