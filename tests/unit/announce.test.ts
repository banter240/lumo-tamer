import { describe, it, expect } from 'vitest';
import { endsWithDanglingColon, isAnnounceWithoutToolCall, isToolCallNarration } from '../../src/api/tools/announce.js';

describe('isAnnounceWithoutToolCall', () => {
  it('detects a started sentence that ends at a colon with nothing after', () => {
    expect(isAnnounceWithoutToolCall("I'll read the files:")).toBe(true);
    expect(isAnnounceWithoutToolCall('Reading the project:\n')).toBe(true);
    expect(endsWithDanglingColon("I'll read the files:")).toBe(true);
  });

  it('is false when a valid tool-call JSON is present', () => {
    const withCall = 'Looking at the repo:\n```json\n{"name":"user:read","arguments":{"path":"a.ts"}}\n```';
    expect(isAnnounceWithoutToolCall(withCall)).toBe(false);
  });

  it('is false for normal answers', () => {
    expect(isAnnounceWithoutToolCall('The bug is in line 42 of foo.ts.')).toBe(false);
    expect(isAnnounceWithoutToolCall('Let me read the file first.')).toBe(false);
    expect(isAnnounceWithoutToolCall('')).toBe(false);
    expect(isAnnounceWithoutToolCall(undefined)).toBe(false);
    expect(endsWithDanglingColon('The ratio is 1:2 in the table.')).toBe(false);
  });

  it('still detects a dangling colon in longer replies (thinking preamble)', () => {
    const longPreamble = 'a'.repeat(1500) + '\nNow I will read the files:';
    expect(longPreamble.length).toBeGreaterThan(600);
    expect(endsWithDanglingColon(longPreamble)).toBe(true);
  });

  it('detects tool-call narration instead of a JSON block', () => {
    expect(isToolCallNarration('Alright, reading the file now.\n[Assistant tool call]: read the config file')).toBe(true);
    expect(isToolCallNarration('Tool call: user:read with path config.yaml')).toBe(true);
    expect(isToolCallNarration('Reading the file first.')).toBe(false);
  });
});
