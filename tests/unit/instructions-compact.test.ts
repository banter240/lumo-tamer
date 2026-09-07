import { describe, it, expect } from 'vitest';
import { buildInstructions, buildLeadInstructions } from '../../src/api/instructions.js';
import { selectNativeTools } from '../../src/lumo-client/native-tools.js';

const searchTool = {
  type: 'function' as const,
  function: {
    name: 'search',
    description: 'Find devices',
    parameters: { type: 'object', properties: { q: { type: 'string' } } },
  },
};

describe('buildInstructions compact', () => {
  it('always keeps full tool schemas, even on follow-up turns', () => {
    const full = buildInstructions([searchTool], 'You are Assist.');
    const compact = buildInstructions([searchTool], 'You are Assist.', { compact: true });
    expect(compact).toContain('Find devices');
    expect(compact).toContain('"q"');
    expect(compact).toContain('user:search');
    expect(full).toContain('CUSTOM TOOL PROTOCOL');
    expect(compact).not.toContain('CUSTOM TOOL PROTOCOL');
    expect(compact).toContain('code block');
    expect(full).toContain('```json');
  });
});

describe('selectNativeTools', () => {
  it('keeps proton_info so HA/plain chat does not lose native tools', () => {
    expect(selectNativeTools({ includeInternal: true, webSearch: false })).toEqual(['proton_info']);
  });
});


describe('buildLeadInstructions', () => {
  const taskTool = {
    type: 'function' as const,
    function: {
      name: 'task',
      description: 'Delegate',
      parameters: { type: 'object', properties: { prompt: { type: 'string' } } },
    },
  };

  it('uses lead fallback without orchestration block when no tools', () => {
    const text = buildLeadInstructions(undefined);
    expect(text).toMatch(/Lumo Lead/i);
    expect(text).not.toMatch(/CUSTOM TOOL PROTOCOL/);
    expect(text).not.toMatch(/ORCHESTRATION TOOLS ONLY/);
    expect(buildInstructions(undefined, undefined, { profile: 'lead' })).toBe(text);
  });

  it('adds slim orchestration protocol for task tools, never coding forTools', () => {
    // Caller (request-prep) must pass already-filtered orchestration tools.
    const text = buildLeadInstructions(undefined, [taskTool]);
    expect(text).toMatch(/ORCHESTRATION TOOLS ONLY/);
    expect(text).toContain('user:task');
    expect(text).not.toContain('user:search');
    expect(text).not.toMatch(/CUSTOM TOOL PROTOCOL/);
  });

  it('prefers cleaned client instructions over fallback', () => {
    const text = buildLeadInstructions('You are the orchestrator.');
    expect(text).toContain('You are the orchestrator.');
    expect(text).not.toMatch(/Lumo Lead/i);
  });
});
