import { describe, it, expect } from 'vitest';
import { buildInstructions } from '../../src/api/instructions.js';
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
    expect(selectNativeTools({ includeInternal: true, webSearch: false, images: false })).toEqual(['proton_info']);
  });
});
