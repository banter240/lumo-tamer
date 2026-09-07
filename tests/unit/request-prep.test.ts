import { describe, it, expect } from 'vitest';
import {
  appendInstructions,
  conversationIdFromClient,
  conversationIdFromUser,
  invalidModelOrEffort,
  prepareToolsAndInstructions,
  resolveRequestTier,
  shouldRequestTitle,
} from '../../src/api/request-prep.js';

describe('appendInstructions', () => {
  it('joins non-empty parts', () => {
    expect(appendInstructions('a', undefined, '  ', 'b')).toBe('a\n\nb');
  });
});

describe('invalidModelOrEffort', () => {
  it('rejects unknown models once for both routes', () => {
    const err = invalidModelOrEffort('gpt-4', undefined, 'reasoning_effort');
    expect(err?.code).toBe('model_not_found');
    expect(err?.param).toBe('model');
  });

  it('rejects bad effort with the caller param name', () => {
    const err = invalidModelOrEffort('lumo', 'ludicrous', 'reasoning.effort');
    expect(err?.code).toBe('invalid_reasoning_effort');
    expect(err?.param).toBe('reasoning.effort');
  });

  it('accepts built-in lumo-lead', () => {
    expect(invalidModelOrEffort('lumo-lead', undefined, 'reasoning_effort')).toBeNull();
  });
});

describe('resolveRequestTier', () => {
  it('uses extraModels reasoning when the request omits effort', () => {
    const resolved = resolveRequestTier('lumo', undefined);
    expect(resolved.name).toBe('lumo');
    expect(resolved.tier).toBeTruthy();
    expect(typeof resolved.enableReasoning).toBe('boolean');
    expect(typeof resolved.surfaceThinking).toBe('boolean');
  });
});

describe('conversation ids', () => {
  it('is deterministic for the same seed in one process', () => {
    expect(conversationIdFromUser('ha-1')).toBe(conversationIdFromUser('ha-1'));
    expect(conversationIdFromClient('c1')).toBe(conversationIdFromClient('c1'));
    expect(conversationIdFromUser('ha-1')).not.toBe(conversationIdFromClient('ha-1'));
  });
});

describe('shouldRequestTitle', () => {
  it('is false without sync — title is a second Lumo call', () => {
    expect(shouldRequestTitle({ queue: {} as never, lumoClient: {} as never }, 'conv')).toBe(false);
    expect(shouldRequestTitle({
      queue: {} as never,
      lumoClient: {} as never,
      syncInitialized: true,
      conversationStore: { get: () => ({ title: 'New Conversation' }) } as never,
    }, 'conv')).toBe(true);
  });
});


describe('prepareToolsAndInstructions lead', () => {
  const searchTool = {
    type: 'function' as const,
    function: {
      name: 'search',
      description: 'Find things',
      parameters: { type: 'object', properties: {} },
    },
  };
  const readTool = {
    type: 'function' as const,
    function: {
      name: 'read',
      description: 'Read a file',
      parameters: { type: 'object', properties: { path: { type: 'string' } } },
    },
  };
  const bashTool = {
    type: 'function' as const,
    function: {
      name: 'bash',
      description: 'Run shell',
      parameters: { type: 'object', properties: { command: { type: 'string' } } },
    },
  };
  const taskTool = {
    type: 'function' as const,
    function: {
      name: 'task',
      description: 'Delegate to a subagent',
      parameters: { type: 'object', properties: { prompt: { type: 'string' } } },
    },
  };
  const TaskTool = {
    type: 'function' as const,
    function: {
      name: 'Task',
      description: 'OpenCode Task',
      parameters: { type: 'object', properties: { prompt: { type: 'string' } } },
    },
  };

  it('keeps task tools, strips read/bash, and uses slim orchestration protocol (no coding forTools)', () => {
    const prepared = prepareToolsAndInstructions(
      [taskTool, TaskTool, readTool, bashTool, searchTool],
      'auto',
      undefined,
      undefined,
      false,
      'lead',
    );
    expect(prepared.tools?.map((t) => t.function.name).sort()).toEqual(['Task', 'task']);
    expect(prepared.instructions).toMatch(/Lumo Lead|orchestrat/i);
    expect(prepared.instructions).toMatch(/ORCHESTRATION TOOLS ONLY/);
    expect(prepared.instructions).toMatch(/"name": "user:task"/);
    expect(prepared.instructions).not.toMatch(/CUSTOM TOOL PROTOCOL/);
    expect(prepared.instructions).not.toMatch(/user:read|user:bash/);
  });

  it('strips all tools when only coding tools are present', () => {
    const prepared = prepareToolsAndInstructions(
      [readTool, bashTool],
      'auto',
      undefined,
      undefined,
      false,
      'lead',
    );
    expect(prepared.tools).toBeUndefined();
    expect(prepared.instructions).toMatch(/Lumo Lead/i);
    expect(prepared.instructions).not.toMatch(/ORCHESTRATION TOOLS ONLY/);
    expect(prepared.instructions).not.toMatch(/CUSTOM TOOL PROTOCOL/);
  });

  it('keeps coding path and forTools for worker (lumo-max / agent:worker)', () => {
    const prepared = prepareToolsAndInstructions(
      [searchTool, readTool],
      'auto',
      'You are Assist.',
      undefined,
      false,
      'worker',
    );
    expect(prepared.tools).toEqual([searchTool, readTool]);
    expect(prepared.instructions).toMatch(/CUSTOM TOOL PROTOCOL/);
    expect(prepared.instructions).toContain('You are Assist.');
  });
});

describe('resolveRequestTier agent', () => {
  it('resolves built-in lumo-lead as lumo-max + thinking + lead', () => {
    const resolved = resolveRequestTier('lumo-lead', undefined);
    expect(resolved.agent).toBe('lead');
    expect(resolved.tier).toBe('lumo-max');
    expect(resolved.enableReasoning).toBe(true);
  });

  it('defaults built-in coding models to worker with tools path', () => {
    const max = resolveRequestTier('lumo-max', undefined);
    expect(max.agent).toBe('worker');
    expect(max.tier).toBe('lumo-max');
    expect(max.enableReasoning).toBe(true);
  });
});
