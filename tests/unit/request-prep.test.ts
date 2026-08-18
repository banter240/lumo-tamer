import { describe, it, expect } from 'vitest';
import {
  appendInstructions,
  conversationIdFromClient,
  conversationIdFromUser,
  invalidModelOrEffort,
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
