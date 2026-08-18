import { describe, it, expect } from 'vitest';
import { splitToolJsonObjects } from '../../src/api/tools/tool-json-split.js';
import { StreamingToolDetector } from '../../src/api/tools/streaming-tool-detector.js';

describe('splitToolJsonObjects', () => {
  it('splits jammed objects and repairs a missing closing brace', () => {
    const blob =
      '{"name":"user:bash","arguments":{"command":"find /tmp -name \'*.py\' | sort"}' +
      '{"name":"user:read","arguments":{"filePath":"/tmp/README.md","offset":712}}' +
      '{"name":"user:read","arguments":{"filePath":"/tmp/docs"}}';

    const parts = splitToolJsonObjects(blob);
    expect(parts).toHaveLength(3);
    expect(JSON.parse(parts[0])).toMatchObject({ name: 'user:bash' });
    expect(JSON.parse(parts[1])).toMatchObject({ name: 'user:read', arguments: { offset: 712 } });
    expect(JSON.parse(parts[2])).toMatchObject({ name: 'user:read' });
  });
});

describe('StreamingToolDetector concatenated JSON', () => {
  it('executes jammed bash+read+read instead of leaking text', () => {
    const detector = new StreamingToolDetector({ knownToolNames: ['bash', 'read'] });
    const blob =
      '{"name":"user:bash","arguments":{"command":"find /tmp -name \'*.py\' | sort"}' +
      '{"name":"user:read","arguments":{"filePath":"/tmp/README.md","offset":712}}' +
      '{"name":"user:read","arguments":{"filePath":"/tmp/docs"}}';
    const chunked = detector.processChunk(blob);
    const end = detector.finalize();
    const calls = [...chunked.completedToolCalls, ...end.completedToolCalls];
    expect(calls.map((c) => c.name)).toEqual(['bash', 'read', 'read']);
    expect(chunked.textToEmit + end.textToEmit).not.toContain('user:bash');
  });
});
