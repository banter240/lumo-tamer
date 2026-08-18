/**
 * Unit tests for message-converter
 *
 * Tests conversion from OpenAI message formats to Lumo Turn format.
 * Note: Instruction injection is now handled by LumoClient, not message-converter.
 * These tests verify that message-converter returns clean turns without instructions.
 */

import { describe, it, expect } from 'vitest';
import { convertOpenAIChatMessages, convertOpenAIResponseMessages, convertToolMessage } from '../../src/api/message-converter.js';

describe('convertOpenAIChatMessages', () => {
  it('converts user and assistant messages', async () => {
    const turns = await convertOpenAIChatMessages([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi!' },
    ]);

    expect(turns).toHaveLength(2);
    expect(turns[0].role).toBe('user');
    expect(turns[0].content).toBe('Hello');
    expect(turns[1].role).toBe('assistant');
    expect(turns[1].content).toBe('Hi!');
  });

  it('skips system messages from output', async () => {
    const turns = await convertOpenAIChatMessages([
      { role: 'system', content: 'Be helpful' },
      { role: 'user', content: 'Hello' },
    ]);

    // System message is skipped, not injected (injection happens in LumoClient)
    expect(turns).toHaveLength(1);
    expect(turns[0].role).toBe('user');
    expect(turns[0].content).toBe('Hello');
  });

  it('returns clean turns without instruction injection', async () => {
    const turns = await convertOpenAIChatMessages([
      { role: 'system', content: 'Be concise' },
      { role: 'user', content: 'Hello' },
    ]);

    // No instruction injection - that happens in LumoClient
    expect(turns[0].content).toBe('Hello');
    expect(turns[0].content).not.toContain('[Project instructions:');
  });

  it('handles multi-turn conversations', async () => {
    const turns = await convertOpenAIChatMessages([
      { role: 'system', content: 'Be concise' },
      { role: 'user', content: 'First message' },
      { role: 'assistant', content: 'Response' },
      { role: 'user', content: 'Second message' },
    ]);

    expect(turns).toHaveLength(3);
    expect(turns[0].content).toBe('First message');
    expect(turns[1].content).toBe('Response');
    expect(turns[2].content).toBe('Second message');
  });

  it('preserves command messages unchanged', async () => {
    const turns = await convertOpenAIChatMessages([
      { role: 'system', content: 'Instructions' },
      { role: 'user', content: '/help' },
    ]);

    expect(turns[0].content).toBe('/help');
  });

  it('handles empty messages array', async () => {
    const turns = await convertOpenAIChatMessages([]);
    expect(turns).toEqual([]);
  });

  it('forwards OpenAI image_url parts as Lumo images', async () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const turns = await convertOpenAIChatMessages([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'what is this' },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${png}` } },
        ],
      } as any,
    ]);

    expect(turns).toHaveLength(1);
    expect(turns[0].content).toBe('what is this');
    expect(turns[0].images).toHaveLength(1);
    expect(turns[0].images![0].data).toBe(png);
    expect(turns[0].images![0].encrypted).toBe(false);
  });
});

describe('convertOpenAIResponseMessages', () => {
  it('handles string input', async () => {
    const turns = await convertOpenAIResponseMessages('Hello');

    expect(turns).toHaveLength(1);
    expect(turns[0].role).toBe('user');
    expect(turns[0].content).toBe('Hello');
  });

  it('returns clean turns for string input (no instruction injection)', async () => {
    const turns = await convertOpenAIResponseMessages('Hello', 'Be concise');

    expect(turns).toHaveLength(1);
    expect(turns[0].content).toBe('Hello');
    expect(turns[0].content).not.toContain('[Project instructions:');
  });

  it('handles message array input', async () => {
    const turns = await convertOpenAIResponseMessages([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi!' },
    ]);

    expect(turns).toHaveLength(2);
    expect(turns[0].role).toBe('user');
    expect(turns[0].content).toBe('Hello');
    expect(turns[1].role).toBe('assistant');
    expect(turns[1].content).toBe('Hi!');
  });

  it('skips system messages from output', async () => {
    const turns = await convertOpenAIResponseMessages([
      { role: 'system', content: 'Custom system instructions here' },
      { role: 'user', content: 'Hello' },
    ]);

    // System message is skipped
    expect(turns).toHaveLength(1);
    expect(turns[0].content).toBe('Hello');
  });

  it('flattens synthetic function_call_output into a user tool-result turn', async () => {
    const turns = await convertOpenAIResponseMessages([
      { role: 'user', content: 'Call a tool' },
      { type: 'function_call_output', call_id: 'read__synth__0123456789abcdef01234567', output: 'file body' } as any,
    ]);

    expect(turns).toHaveLength(2);
    expect(turns[1].role).toBe('user');
    expect(turns[1].content).toBe('[Tool Result: read]\nfile body');
    expect(turns[1].content).not.toContain('call_id');
  });

  it('handles function_call_output items', async () => {
    const turns = await convertOpenAIResponseMessages([
      { role: 'user', content: 'Call a tool' },
      { type: 'function_call_output', call_id: 'call_1', output: 'result' } as any,
      { role: 'user', content: 'Follow up' },
    ]);

    expect(turns).toHaveLength(3);
    expect(turns[0].content).toBe('Call a tool');
    expect(turns[1].role).toBe('user');
    expect(turns[1].content).toBe('[Tool Result: tool]\nresult');
    expect(turns[2].content).toBe('Follow up');
  });

  it('returns empty array for undefined input', async () => {
    expect(await convertOpenAIResponseMessages(undefined)).toEqual([]);
  });

  it('preserves command strings unchanged', async () => {
    const turns = await convertOpenAIResponseMessages('/save');

    expect(turns).toHaveLength(1);
    expect(turns[0].content).toBe('/save');
  });
});

describe('convertToolMessage', () => {
  it('normalizes role: "tool" message to user tool-result text', () => {
    const result = convertToolMessage({
      role: 'tool',
      tool_call_id: 'call_abc123',
      content: 'Tool output here',
    });

    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(false);
    const normalized = result as { role: string; content: string };
    expect(normalized.role).toBe('user');
    expect(normalized.content).toBe('[Tool Result: tool]\nTool output here');
  });

  it('normalizes assistant with tool_calls to a short assistant turn', () => {
    const result = convertToolMessage({
      role: 'assistant',
      content: null,
      tool_calls: [
        { id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"NYC"}' } },
        { id: 'call_2', type: 'function', function: { name: 'get_time', arguments: '{}' } },
      ],
    });

    expect(result).not.toBeNull();
    const normalized = result as { role: string; content: string };
    expect(normalized.role).toBe('assistant');
    expect(normalized.content).toBe(
      '```json\n{"name":"user:get_weather","arguments":{"city":"NYC"}}\n```\n```json\n{"name":"user:get_time","arguments":{}}\n```',
    );
  });

  it('normalizes function_call (Responses API) to short assistant text', () => {
    const result = convertToolMessage({
      type: 'function_call',
      call_id: 'call_xyz',
      name: 'search',
      arguments: '{"query":"test"}',
    });

    expect(result).not.toBeNull();
    const normalized = result as { role: string; content: string };
    expect(normalized.role).toBe('assistant');
    expect(normalized.content).toBe('```json\n{"name":"user:search","arguments":{"query":"test"}}\n```');
  });

  it('normalizes function_call_output (Responses API) to user tool-result text', () => {
    const result = convertToolMessage({
      type: 'function_call_output',
      call_id: 'call_xyz',
      output: 'Search results here',
    });

    expect(result).not.toBeNull();
    const normalized = result as { role: string; content: string };
    expect(normalized.role).toBe('user');
    expect(normalized.content).toBe('[Tool Result: tool]\nSearch results here');
  });

  it('returns null for regular messages (no normalization needed)', async () => {
    expect(convertToolMessage({ role: 'user', content: 'Hello' })).toBeNull();
    expect(convertToolMessage({ role: 'assistant', content: 'Hi!' })).toBeNull();
    expect(convertToolMessage({ role: 'system', content: 'Be helpful' })).toBeNull();
  });

  it('returns null for invalid inputs', async () => {
    expect(convertToolMessage(null)).toBeNull();
    expect(convertToolMessage(undefined)).toBeNull();
    expect(convertToolMessage('string')).toBeNull();
    expect(convertToolMessage(123)).toBeNull();
  });
});

describe('convertOpenAIChatMessages with tool messages', () => {
  it('converts role: "tool" message to user tool-result text', async () => {
    const turns = await convertOpenAIChatMessages([
      { role: 'user', content: 'Call a tool' },
      { role: 'tool', tool_call_id: 'call_abc', content: 'Tool result' } as any,
    ]);

    expect(turns).toHaveLength(2);
    expect(turns[0].role).toBe('user');
    expect(turns[0].content).toBe('Call a tool');
    expect(turns[1].role).toBe('user');
    expect(turns[1].content).toBe('[Tool Result: tool]\nTool result');
  });

  it('converts assistant with tool_calls to a short assistant turn', async () => {
    const turns = await convertOpenAIChatMessages([
      { role: 'user', content: 'Get the weather' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"NYC"}' } },
        ],
      } as any,
    ]);

    expect(turns).toHaveLength(2);
    expect(turns[0].role).toBe('user');
    expect(turns[0].content).toBe('Get the weather');
    expect(turns[1].role).toBe('assistant');
    expect(turns[1].content).toBe('```json\n{"name":"user:get_weather","arguments":{"city":"NYC"}}\n```');
  });

  it('handles full tool call conversation flow', async () => {
    const turns = await convertOpenAIChatMessages([
      { role: 'user', content: 'What is the weather in NYC?' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call_weather', type: 'function', function: { name: 'get_weather', arguments: '{"city":"NYC"}' } },
        ],
      } as any,
      { role: 'tool', tool_call_id: 'call_weather', content: 'Sunny, 72F' } as any,
      { role: 'assistant', content: 'The weather in NYC is sunny and 72F.' },
    ]);

    expect(turns).toHaveLength(4);
    expect(turns[0].role).toBe('user');
    expect(turns[0].content).toBe('What is the weather in NYC?');
    expect(turns[1].role).toBe('assistant'); // tool_calls
    expect(turns[2].role).toBe('user'); // tool result
    expect(turns[3].role).toBe('assistant'); // final response
    expect(turns[3].content).toBe('The weather in NYC is sunny and 72F.');
  });
});
