import { describe, it, expect, afterEach } from 'vitest';
import * as readline from 'readline';
import { PassThrough } from 'stream';
import { createLinePrompt } from '../../src/cli/prompt.js';

describe('createLinePrompt', () => {
  let rl: readline.Interface;

  afterEach(() => {
    rl?.close();
  });

  it('registers a single close listener no matter how often you prompt', () => {
    rl = readline.createInterface({
      input: new PassThrough(),
      output: new PassThrough(),
    });
    const before = rl.listenerCount('close');
    const prompt = createLinePrompt(rl);
    expect(rl.listenerCount('close')).toBe(before + 1);
    void prompt();
    void prompt();
    void prompt();
    expect(rl.listenerCount('close')).toBe(before + 1);
  });

  it('resolves null after the interface is closed', async () => {
    rl = readline.createInterface({
      input: new PassThrough(),
      output: new PassThrough(),
    });
    const prompt = createLinePrompt(rl);
    rl.close();
    await expect(prompt()).resolves.toBeNull();
  });
});
