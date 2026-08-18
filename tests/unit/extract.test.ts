import { describe, it, expect } from 'vitest';
import { extractOneToolCall, extractToolCalls, stripTrailingFenceJunk } from '../../src/api/tools/extract.js';

describe('extractToolCalls', () => {
  it('parses strict JSON', () => {
    const call = extractOneToolCall(
      '{"name":"user:bash","arguments":{"command":"ls"}}',
    );
    expect(call).toEqual({ name: 'user:bash', arguments: { command: 'ls' } });
  });

  it('strips a trailing markdown fence', () => {
    const call = extractOneToolCall(
      '{"name":"user:read","arguments":{"filePath":"/tmp/a"}} ```',
    );
    expect(call?.arguments).toEqual({ filePath: '/tmp/a' });
  });

  it('keeps raw newlines inside a prompt string', () => {
    const blob =
      '{"name":"user:task","arguments":{"description":"Analyse const.py","subagent_type":"explore","prompt":"Line one\nLine two\npath: /tmp/const.py"}}';
    const call = extractOneToolCall(blob);
    expect(call?.name).toBe('user:task');
    expect(call?.arguments.subagent_type).toBe('explore');
    expect(call?.arguments.prompt).toContain('Line two');
  });

  it('recovers a task call when the prompt contains unescaped quotes', () => {
    const blob =
      '{"name":"user:task","arguments":{"description":"Analyse const.py","subagent_type":"explore","prompt":"Compare README: "Status Polling: 30m" and more"}}';
    const call = extractOneToolCall(blob);
    expect(call?.name).toBe('user:task');
    expect(call?.arguments.description).toBe('Analyse const.py');
    expect(String(call?.arguments.prompt)).toContain('Status Polling');
  });

  it('recovers the logged task blob with fence closer', () => {
    const blob =
      '{"name":"user:task","arguments":{"description":"Analyse const.py und config_flow.py","subagent_type":"explore","prompt":"Thoroughness: very thorough.\nRead const.py and config_flow.py.\nReport defaults."}} ```';
    const call = extractOneToolCall(blob);
    expect(call).toMatchObject({
      name: 'user:task',
      arguments: {
        description: 'Analyse const.py und config_flow.py',
        subagent_type: 'explore',
      },
    });
    expect(String(call?.arguments.prompt)).toContain('const.py');
  });

  it('splits jammed bash+read objects', () => {
    const blob =
      '{"name":"user:bash","arguments":{"command":"find /tmp -name \'*.py\' | sort"}' +
      '{"name":"user:read","arguments":{"filePath":"/tmp/README.md","offset":712}}';
    const calls = extractToolCalls(blob);
    expect(calls.map((c) => c.name)).toEqual(['user:bash', 'user:read']);
  });
});

describe('stripTrailingFenceJunk', () => {
  it('drops repeated json language tags', () => {
    expect(stripTrailingFenceJunk('Checking files.\njson\njson\njson\n')).toBe('Checking files.\n');
  });

  it('drops incomplete backticks plus json before a raw object', () => {
    expect(stripTrailingFenceJunk('Checking files.``json\njson\n')).toBe('Checking files.');
  });
});
