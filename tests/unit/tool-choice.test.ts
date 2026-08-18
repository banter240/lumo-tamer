import { describe, it, expect } from 'vitest';
import { parseToolChoice, toolsForChoice } from '../../src/api/tools/tool-choice.js';
import type { OpenAITool } from '../../src/api/types.js';

const tools: OpenAITool[] = [
  { type: 'function', function: { name: 'read_file' } },
  { type: 'function', function: { name: 'write_file' } },
];

describe('parseToolChoice', () => {
  it('defaults to auto', () => {
    expect(parseToolChoice(undefined)).toEqual({ mode: 'auto' });
    expect(parseToolChoice('auto')).toEqual({ mode: 'auto' });
  });

  it('parses none, required, and a named function', () => {
    expect(parseToolChoice('none')).toEqual({ mode: 'none' });
    expect(parseToolChoice('required')).toEqual({ mode: 'required' });
    expect(parseToolChoice({ type: 'function', function: { name: 'read_file' } })).toEqual({
      mode: 'named',
      name: 'read_file',
    });
  });

  it('rejects junk', () => {
    expect(() => parseToolChoice('sometimes')).toThrow(/Invalid/);
  });
});

describe('toolsForChoice', () => {
  it('drops tools when choice is none', () => {
    expect(toolsForChoice(tools, { mode: 'none' })).toBeUndefined();
  });

  it('keeps only the named tool', () => {
    expect(toolsForChoice(tools, { mode: 'named', name: 'write_file' })).toEqual([
      { type: 'function', function: { name: 'write_file' } },
    ]);
  });

  it('keeps all tools for auto and required', () => {
    expect(toolsForChoice(tools, { mode: 'auto' })).toEqual(tools);
    expect(toolsForChoice(tools, { mode: 'required' })).toEqual(tools);
  });
});
