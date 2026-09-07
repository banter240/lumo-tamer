import { describe, it, expect } from 'vitest';
import { isOrchestrationToolName, filterToolsForLead } from '../../src/api/tools/lead-tools.js';
import type { OpenAITool } from '../../src/api/types.js';

function tool(name: string): OpenAITool {
  return { type: 'function', function: { name, description: name, parameters: { type: 'object', properties: {} } } };
}

describe('isOrchestrationToolName', () => {
  it('matches task / Task / subagent case-insensitively', () => {
    expect(isOrchestrationToolName('task')).toBe(true);
    expect(isOrchestrationToolName('Task')).toBe(true);
    expect(isOrchestrationToolName('TASK')).toBe(true);
    expect(isOrchestrationToolName('user:task')).toBe(true);
    expect(isOrchestrationToolName('subagent')).toBe(true);
    expect(isOrchestrationToolName('run_task')).toBe(true);
  });

  it('rejects coding tools', () => {
    for (const n of ['read', 'write', 'edit', 'bash', 'glob', 'grep', 'search', 'list']) {
      expect(isOrchestrationToolName(n)).toBe(false);
    }
  });
});

describe('filterToolsForLead', () => {
  it('keeps orchestration tools and drops the rest', () => {
    const kept = filterToolsForLead([
      tool('Task'), tool('read'), tool('bash'), tool('task'), tool('grep'),
    ]);
    expect(kept?.map((t) => t.function.name)).toEqual(['Task', 'task']);
  });

  it('returns undefined when nothing allowlisted', () => {
    expect(filterToolsForLead([tool('read'), tool('bash')])).toBeUndefined();
    expect(filterToolsForLead(undefined)).toBeUndefined();
  });
});
