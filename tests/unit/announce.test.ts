import { describe, it, expect } from 'vitest';
import { isAnnounceWithoutToolCall } from '../../src/api/tools/announce.js';

describe('isAnnounceWithoutToolCall', () => {
  it('detects common narration without a tool call', () => {
    expect(isAnnounceWithoutToolCall('Let me read the file first.')).toBe(true);
    expect(isAnnounceWithoutToolCall('Reading all files in the project…')).toBe(true);
    expect(isAnnounceWithoutToolCall("I'll check the directory structure.")).toBe(true);
    expect(isAnnounceWithoutToolCall('I am going to search the codebase.')).toBe(true);
  });

  it('is false when a valid tool-call JSON is present', () => {
    const withCall = 'Let me read that.\n```json\n{"name":"user:read","arguments":{"path":"a.ts"}}\n```';
    expect(isAnnounceWithoutToolCall(withCall)).toBe(false);
  });

  it('is false for normal answers', () => {
    expect(isAnnounceWithoutToolCall('The bug is in line 42 of foo.ts.')).toBe(false);
    expect(isAnnounceWithoutToolCall('')).toBe(false);
    expect(isAnnounceWithoutToolCall(undefined)).toBe(false);
  });
});
