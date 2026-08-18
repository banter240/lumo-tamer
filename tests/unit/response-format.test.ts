import { describe, it, expect } from 'vitest';
import { parseResponseFormat, stripJsonFences, buildJsonFormatInstruction } from '../../src/api/response-format.js';

describe('parseResponseFormat', () => {
  it('returns undefined for missing or text', () => {
    expect(parseResponseFormat(undefined)).toBeUndefined();
    expect(parseResponseFormat({ type: 'text' })).toBeUndefined();
  });

  it('parses json_object', () => {
    expect(parseResponseFormat({ type: 'json_object' })).toEqual({ kind: 'json_object' });
  });

  it('parses json_schema with nested schema', () => {
    const schema = { type: 'object', properties: { name: { type: 'string' } } };
    expect(parseResponseFormat({
      type: 'json_schema',
      json_schema: { name: 'person', schema },
    })).toEqual({ kind: 'json_schema', schema, name: 'person' });
  });

  it('rejects unknown types', () => {
    expect(() => parseResponseFormat({ type: 'xml' })).toThrow(/Unsupported/);
  });

  it('rejects json_schema without a schema', () => {
    expect(() => parseResponseFormat({ type: 'json_schema', json_schema: { name: 'x' } })).toThrow(/schema/);
  });
});

describe('stripJsonFences', () => {
  it('unwraps a json fence', () => {
    expect(stripJsonFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('extracts the first JSON object from chatter', () => {
    expect(stripJsonFences('Sure!\n{"a": 1}\n')).toBe('{"a": 1}');
  });

  it('leaves already-clean JSON alone', () => {
    expect(stripJsonFences('{"ok":true}')).toBe('{"ok":true}');
  });
});

describe('buildJsonFormatInstruction', () => {
  it('includes the schema in the instruction', () => {
    const text = buildJsonFormatInstruction({
      kind: 'json_schema',
      schema: { type: 'object' },
    });
    expect(text).toMatch(/valid JSON/i);
    expect(text).toContain('"type": "object"');
  });
});
