/**
 * Unit tests for StreamingToolDetector
 *
 * Tests the state machine that detects JSON tool calls in streaming text,
 * supporting both code fence (```json) and raw JSON formats.
 */

import { describe, it, expect } from 'vitest';
import { StreamingToolDetector } from '../../src/api/tools/streaming-tool-detector.js';

/** Feed chunks through detector and return accumulated text + tool calls */
function processAll(detector: StreamingToolDetector, chunks: string[]) {
  let allText = '';
  const allToolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [];

  for (const chunk of chunks) {
    const result = detector.processChunk(chunk);
    allText += result.textToEmit;
    allToolCalls.push(...result.completedToolCalls);
  }

  const final = detector.finalize();
  allText += final.textToEmit;
  allToolCalls.push(...final.completedToolCalls);

  return { allText, allToolCalls };
}

describe('StreamingToolDetector', () => {
  describe('code fence detection', () => {
    it('detects tool call in code fence format', () => {
      const detector = new StreamingToolDetector();
      const { allText, allToolCalls } = processAll(detector, [
        'Here is the result: ',
        '```json\n{"name":"get_weather",',
        '"arguments":{"city":"Paris"}}',
        '```',
        ' Done!',
      ]);

      expect(allToolCalls).toHaveLength(1);
      expect(allToolCalls[0].name).toBe('get_weather');
      expect(allToolCalls[0].arguments).toEqual({ city: 'Paris' });
      expect(allText).toContain('Here is the result:');
      expect(allText).toContain('Done!');
      expect(allText).not.toContain('get_weather');
    });

    it('does not leak json language tags before a fence', () => {
      const detector = new StreamingToolDetector({ knownToolNames: ['edit'] });
      const { allText, allToolCalls } = processAll(detector, [
        'Checking files.\njson\njson\njson\n```json\n{"name":"user:edit","arguments":{"filePath":"/tmp/README.md","oldString":"a","newString":"b"}}\n```',
      ]);
      expect(allToolCalls).toHaveLength(1);
      expect(allToolCalls[0].name).toBe('edit');
      expect(allText).toContain('Checking files.');
      expect(allText.replace(/[`\s]/g, '').toLowerCase()).not.toContain('json');
    });

    it('does not leak json/```json when Lumo doubles the fence opener', () => {
      const detector = new StreamingToolDetector({ knownToolNames: ['read'] });
      const { allText, allToolCalls } = processAll(detector, [
        '```json\n```json\n{"name":"user:read","arguments":{"filePath":"/tmp/a"}}\n```',
      ]);
      expect(allToolCalls).toEqual([{ name: 'read', arguments: { filePath: '/tmp/a' } }]);
      expect(allText.replace(/[`\s]/g, '')).not.toContain('json');
    });

    it('detects tool call in code fence without json tag', () => {
      const detector = new StreamingToolDetector();
      const { allToolCalls } = processAll(detector, [
        '```\n{"name":"notag","arguments":{}}\n```',
      ]);

      expect(allToolCalls).toHaveLength(1);
      expect(allToolCalls[0].name).toBe('notag');
    });

    it('detects OpenAI-style function_call in code fence and parses string arguments', () => {
      const detector = new StreamingToolDetector();
      const { allToolCalls } = processAll(detector, [
        '```json\n{"type":"function_call","name":"exec","arguments":"{\\"command\\":\\"echo hi\\"}"}\n```',
      ]);

      expect(allToolCalls).toHaveLength(1);
      expect(allToolCalls[0]).toEqual({ name: 'exec', arguments: { command: 'echo hi' } });
    });

    it('detects tool call with parameters alias', () => {
      const detector = new StreamingToolDetector();
      const { allToolCalls } = processAll(detector, [
        '```json\n{"name":"search","parameters":{"q":"weather"}}\n```',
      ]);

      expect(allToolCalls).toHaveLength(1);
      expect(allToolCalls[0]).toEqual({ name: 'search', arguments: { q: 'weather' } });
    });

    it('detects multiple tool calls', () => {
      const detector = new StreamingToolDetector();
      const { allToolCalls } = processAll(detector, [
        `First tool:\n\`\`\`json\n{"name":"tool1","arguments":{"a":1}}\n\`\`\`\nSecond tool:\n\`\`\`json\n{"name":"tool2","arguments":{"b":2}}\n\`\`\`\nDone`,
      ]);

      expect(allToolCalls).toHaveLength(2);
      expect(allToolCalls[0].name).toBe('tool1');
      expect(allToolCalls[1].name).toBe('tool2');
    });

    it('emits incomplete JSON at stream end as text', () => {
      const detector = new StreamingToolDetector();
      const { allText, allToolCalls } = processAll(detector, [
        '```json\n{"name":"incomplete",',
        '"arguments":{',
      ]);

      expect(allToolCalls).toHaveLength(0);
      expect(allText).toContain('incomplete');
    });
  });

  describe('raw JSON detection', () => {
    it('detects tool call in raw JSON format', () => {
      const detector = new StreamingToolDetector();
      const { allToolCalls } = processAll(detector, [
        'I will call the function:\n',
        '{"name":"search",',
        '"arguments":{"query":"test"}}',
        '\nDone',
      ]);

      expect(allToolCalls).toHaveLength(1);
      expect(allToolCalls[0].name).toBe('search');
      expect(allToolCalls[0].arguments).toEqual({ query: 'test' });
    });

    it('handles nested braces in arguments', () => {
      const detector = new StreamingToolDetector();
      const { allToolCalls } = processAll(detector, [
        '\n{"name":"complex","arguments":{"nested":{"deep":{"value":42}}}}',
      ]);

      expect(allToolCalls).toHaveLength(1);
      expect(allToolCalls[0].name).toBe('complex');
      expect(allToolCalls[0].arguments).toEqual({ nested: { deep: { value: 42 } } });
    });

    it('handles escaped quotes in arguments', () => {
      const detector = new StreamingToolDetector();
      const { allToolCalls } = processAll(detector, [
        '\n{"name":"quote_test","arguments":{"text":"say \\"hello\\" world"}}',
      ]);

      expect(allToolCalls).toHaveLength(1);
      expect(allToolCalls[0].arguments).toEqual({ text: 'say "hello" world' });
    });

    it('detects nested OpenAI function shape', () => {
      const detector = new StreamingToolDetector();
      const { allToolCalls } = processAll(detector, [
        '\n{"type":"function","function":{"name":"GetWeather","arguments":"{\\"city\\":\\"Boston\\"}"}}',
      ]);

      expect(allToolCalls).toHaveLength(1);
      expect(allToolCalls[0]).toEqual({ name: 'GetWeather', arguments: { city: 'Boston' } });
    });

    it('detects raw JSON with character-by-character streaming', () => {
      const detector = new StreamingToolDetector();
      const json = '{\n  "name": "HassTurnOff",\n  "arguments": {\n    "name": "office"\n  }\n}';
      const { allToolCalls } = processAll(detector, [...json]);

      expect(allToolCalls).toHaveLength(1);
      expect(allToolCalls[0].name).toBe('HassTurnOff');
      expect(allToolCalls[0].arguments).toEqual({ name: 'office' });
    });

    it('detects raw JSON with chunks splitting strings', () => {
      const detector = new StreamingToolDetector();
      const { allToolCalls } = processAll(detector, [
        '{\n  "na',
        'me": "Has',
        'sTurnOff",\n  "argu',
        'ments": {\n    "na',
        'me": "off',
        'ice"\n  }\n}',
      ]);

      expect(allToolCalls).toHaveLength(1);
      expect(allToolCalls[0].name).toBe('HassTurnOff');
      expect(allToolCalls[0].arguments).toEqual({ name: 'office' });
    });

    it('handles strings containing brace characters', () => {
      const detector = new StreamingToolDetector();
      const { allToolCalls } = processAll(detector, [
        '{\n  "name": "test",\n  "argu',
        'ments": {\n    "text": "hello {wor',
        'ld} bye"\n  }\n}',
      ]);

      expect(allToolCalls).toHaveLength(1);
      expect(allToolCalls[0].name).toBe('test');
      expect(allToolCalls[0].arguments).toEqual({ text: 'hello {world} bye' });
    });

    it('detects tool call JSON after prose on the same line', () => {
      const detector = new StreamingToolDetector();
      const { allText, allToolCalls } = processAll(detector, [
        'Here is the file content: {"name":"read","arguments":{"path":"README.md"}}',
      ]);

      expect(allToolCalls).toHaveLength(1);
      expect(allToolCalls[0]).toEqual({ name: 'read', arguments: { path: 'README.md' } });
      expect(allText).toContain('Here is the file content:');
      expect(allText).not.toContain('"name":"read"');
    });

    it('detects inline tool JSON split across chunks before the brace', () => {
      const detector = new StreamingToolDetector();
      const { allToolCalls } = processAll(detector, [
        'Calling now: {',
        '"name":"read","arguments":{"path":"a.txt"}}',
      ]);

      expect(allToolCalls).toHaveLength(1);
      expect(allToolCalls[0].name).toBe('read');
    });
  });

  describe('non-tool content', () => {
    it('passes non-tool JSON through as text', () => {
      const detector = new StreamingToolDetector();
      const { allText, allToolCalls } = processAll(detector, [
        'Here is some config:\n',
        '{"foo":"bar","baz":123}',
        '\nEnd',
      ]);

      expect(allToolCalls).toHaveLength(0);
      expect(allText).toContain('foo');
      expect(allText).toContain('bar');
    });

    it('leaves mid-line JSON that is not a tool call as text', () => {
      const detector = new StreamingToolDetector();
      const { allText, allToolCalls } = processAll(detector, [
        'Config: {"foo":"bar","baz":123} done',
      ]);

      expect(allToolCalls).toHaveLength(0);
      expect(allText).toContain('{"foo":"bar","baz":123}');
    });
  });

  describe('known tool names', () => {
    it('accepts an inline call only when the name is registered', () => {
      const detector = new StreamingToolDetector({ knownToolNames: ['read'] });
      const { allText, allToolCalls } = processAll(detector, [
        'Here is the file content: {"name":"read","arguments":{"path":"README.md"}}',
      ]);

      expect(allToolCalls).toHaveLength(1);
      expect(allToolCalls[0].name).toBe('read');
      expect(allText).not.toContain('"name":"read"');
    });

    it('emits example JSON as text when the name is not registered', () => {
      const detector = new StreamingToolDetector({ knownToolNames: ['read'] });
      const json = '{"name":"example_tool","arguments":{"param":"value"}}';
      const { allText, allToolCalls } = processAll(detector, [
        `For example ${json} in the docs`,
      ]);

      expect(allToolCalls).toHaveLength(0);
      expect(allText).toContain(json);
    });
  });

  describe('history header echo', () => {
    it('executes Tool Call: name plus args JSON when that is the only call', () => {
      const detector = new StreamingToolDetector({ knownToolNames: ['bash'] });
      const { allText, allToolCalls } = processAll(detector, [
        'fixen:Tool Call: bash\n{"command":"git diff scripts/validate_translations.py"}',
      ]);

      expect(allToolCalls).toEqual([
        { name: 'bash', arguments: { command: 'git diff scripts/validate_translations.py' } },
      ]);
      expect(allText).toContain('fixen:');
      expect(allText).not.toContain('git diff');
    });

    it('executes [Tool Call: name] plus args JSON when that is the only call', () => {
      const detector = new StreamingToolDetector({ knownToolNames: ['read'] });
      const { allToolCalls, allText } = processAll(detector, [
        '[Tool Call: read]\n{"filePath":"/tmp/a.py","limit":20,"offset":154}',
      ]);

      expect(allToolCalls).toEqual([
        { name: 'read', arguments: { filePath: '/tmp/a.py', limit: 20, offset: 154 } },
      ]);
      expect(allText).not.toContain('Tool Call');
    });

    it('drops the history echo when a named JSON call follows', () => {
      const detector = new StreamingToolDetector({ knownToolNames: ['bash', 'grep'] });
      const { allToolCalls, allText } = processAll(detector, [
        'Tool Call: bash\n{"command":"rg apply_zone_state"}\n',
        '{"name":"user:grep","arguments":{"pattern":"apply_zone_state"}}',
      ]);

      expect(allToolCalls).toEqual([
        { name: 'grep', arguments: { pattern: 'apply_zone_state' } },
      ]);
      expect(allText).not.toContain('rg apply_zone_state');
    });

    it('strips the user: prefix from a history header', () => {
      const detector = new StreamingToolDetector({ knownToolNames: ['bash'] });
      const { allToolCalls } = processAll(detector, [
        'Tool Call: user:bash\n{"command":"ls"}',
      ]);

      expect(allToolCalls).toEqual([{ name: 'bash', arguments: { command: 'ls' } }]);
    });

    it('executes Done name plus args JSON (flatten copy without brackets)', () => {
      const detector = new StreamingToolDetector({ knownToolNames: ['read'] });
      const { allToolCalls, allText } = processAll(detector, [
        'achte genau auf dein call....\nDone read\n{"filePath":"/tmp/coordinator.py","offset":770,"limit":50}',
      ]);

      expect(allToolCalls).toEqual([
        {
          name: 'read',
          arguments: { filePath: '/tmp/coordinator.py', offset: 770, limit: 50 },
        },
      ]);
      expect(allText).toContain('achte genau auf dein call....');
      expect(allText).not.toContain('coordinator.py');
    });

    it('leaves an unknown history header as text', () => {
      const detector = new StreamingToolDetector({ knownToolNames: ['bash'] });
      const { allText, allToolCalls } = processAll(detector, [
        'Tool Call: nope\n{"command":"ls"}',
      ]);

      expect(allToolCalls).toHaveLength(0);
      expect(allText).toContain('Tool Call: nope');
      expect(allText).toContain('"command":"ls"');
    });
  });
});
