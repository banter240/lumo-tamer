import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LumoClient, COMPLETION_RETRY_DELAYS_MS } from '../../src/lumo-client/client.js';
import { Role } from '../../src/lumo-client/types.js';
import type { ProtonApiOptions } from '../../src/lumo-client/types.js';
import { estimatePromptTokens } from '../../src/app/token-estimate.js';
import { getServerConfig } from '../../src/app/config.js';

/** Build a fake SSE ReadableStream from CompletionChunk objects, ending with [DONE]. */
function sseStream(chunks: object[]): ReadableStream<Uint8Array> {
    const enc = new TextEncoder();
    const lines = [...chunks.map((c) => `data:${JSON.stringify(c)}\n`), 'data:[DONE]\n'];
    return new ReadableStream({
        start(controller) {
            for (const l of lines) controller.enqueue(enc.encode(l));
            controller.close();
        },
    });
}

const cc = (delta: object, extra: object = {}) => ({
    object: 'CompletionChunk', model: 'lumo-max', choices: [{ index: 0, delta }], ...extra,
});

/** LumoClient wired to a plaintext fake transport (no encryption). */
function makeClient(handler: (opts: ProtonApiOptions) => object[]) {
    const api = vi.fn(async (opts: ProtonApiOptions) => sseStream(handler(opts)));
    const client = new LumoClient(api as never, { enableEncryption: false });
    return { client, api };
}

describe('LumoClient (Lumo 2.0 chat/completions)', () => {
    it('accumulates reasoning separately from content, even without an onReasoning sink', async () => {
        const { client } = makeClient(() => [cc({ content: 'Answer' }), cc({ reasoning: 'thinking' })]);
        const res = await client.chatWithHistory([{ role: Role.User, content: 'hi' }]);
        expect(res.message.content).toBe('Answer');
        expect(res.reasoning).toBe('thinking');
    });

    it('does not leak reasoning-targeted content into the answer', async () => {
        const { client } = makeClient(() => [
            cc({ content: 'visible' }),
            { object: 'CompletionChunk', choices: [{ delta: { target: 'reasoning', content: 'hidden' } }] },
        ]);
        const res = await client.chatWithHistory([{ role: Role.User, content: 'hi' }]);
        expect(res.message.content).toBe('visible');
        expect(res.reasoning).toBe('hidden');
    });

    it('captures the full tool-call arguments from streamed deltas', async () => {
        const { client } = makeClient(() => [
            cc({ tool_calls: [{ index: 0, function: { name: 'web_search' } }] }),
            cc({ tool_calls: [{ index: 0, function: { arguments: '{"q":' } }] }),
            cc({ tool_calls: [{ index: 0, function: { arguments: '"cats"}' } }] }),
        ]);
        const res = await client.chatWithHistory([{ role: Role.User, content: 'find cats' }]);
        expect(res.message.toolCall).toBeDefined();
        expect(JSON.parse(res.message.toolCall!)).toEqual({ name: 'web_search', arguments: { q: 'cats' } });
    });

    it('streams a generated image as markdown and persists only the marker', async () => {
        const png = 'iVBORw0KGgoAAAA';
        const { client } = makeClient(() => [
            cc({ content: 'Voici :' }),
            { object: 'lumo.image_data', image: { id: 'img-1', data: png, seed: 7 } },
        ]);
        const chunks: string[] = [];
        const res = await client.chatWithHistory([{ role: Role.User, content: 'draw' }], (c) => chunks.push(c));
        expect(chunks.join('')).toContain(`![lumo:img-1](data:image/png;base64,${png})`);
        expect(res.message.content).toContain('<lumo-image id="img-1" source="assistant" />');
        expect(res.message.content).not.toContain(png);
    });

    it('treats image tools as native (no misrouted-tool bounce)', async () => {
        const { client, api } = makeClient(() => [
            { object: 'chat.tool_call', tool_call: { id: 'c1', name: 'generate_image', arguments: '{"prompt":"cat"}' } },
            { object: 'lumo.image_data', image: { id: 'img-2', data: 'iVBORw0KGgo=' } },
            cc({ content: 'done' }),
        ]);
        const res = await client.chatWithHistory([{ role: Role.User, content: 'draw a cat' }]);
        expect(api).toHaveBeenCalledTimes(1);
        expect(res.misrouted).toBe(false);
        expect(res.message.content).toContain('done');
    });

    it('captures usage (tier category + serving model)', async () => {
        let sentBody: unknown;
        const { client } = makeClient((opts) => {
            sentBody = opts.data;
            return [
                cc({ content: 'x' }),
                { object: 'CompletionChunk', model: 'lumo-max', choices: [], usage: { completion_tokens: 2, applied_limit_category: 'max' } },
            ];
        });
        const res = await client.chatWithHistory([{ role: Role.User, content: 'hi' }]);
        const bytes = Buffer.byteLength(JSON.stringify(sentBody), 'utf8');
        expect(res.usage).toEqual({
          completion_tokens: 2,
          applied_limit_category: 'max',
          model: 'lumo-max',
          prompt_tokens: estimatePromptTokens(
            bytes,
            getServerConfig().promptTokenEstimation,
            getServerConfig().promptTokenEstimationFactor ?? 1.0,
          ),
        });
      });

    it('issues a separate title completion and uses its content', async () => {
        const { client, api } = makeClient((opts) => {
            const target = (opts.data as { lumo?: { target?: string } }).lumo?.target;
            return target === 'title' ? [cc({ content: 'A Good Title' })] : [cc({ content: 'body' })];
        });
        const res = await client.chatWithHistory([{ role: Role.User, content: 'hi' }], undefined, { requestTitle: true });
        expect(api).toHaveBeenCalledTimes(2);
        expect(res.message.content).toBe('body');
        expect(res.title).toBe('A Good Title');
    });

    it('bounces a misrouted custom tool and requests the title only once', async () => {
        let messageCalls = 0;
        let titleCalls = 0;
        const { client } = makeClient((opts) => {
            const target = (opts.data as { lumo?: { target?: string } }).lumo?.target;
            if (target === 'title') {
                titleCalls++;
                return [cc({ content: 'Title' })];
            }
            messageCalls++;
            return messageCalls === 1
                ? [cc({ tool_calls: [{ index: 0, function: { name: 'my_custom_tool', arguments: '{"a":1}' } }] })]
                : [cc({ content: 'final answer' })];
        });
        const res = await client.chatWithHistory([{ role: Role.User, content: 'hi' }], undefined, { requestTitle: true });
        expect(res.message.content).toBe('final answer');
        expect(res.title).toBe('Title');
        expect(titleCalls).toBe(1);
        expect(messageCalls).toBe(2);
    });

    describe('transient-error retry', () => {
        // Real-world stream error seen repeatedly in production:
        // Proton answers 200 then errors mid-stream when out of capacity.
        const capacityError = { error: { message: 'API returned error: Request timed out waiting for capacity. Please try again.' } };

        // Shorten the backoff so tests run fast; restore after each test.
        beforeEach(() => {
            COMPLETION_RETRY_DELAYS_MS.splice(0, COMPLETION_RETRY_DELAYS_MS.length, 10, 10);
        });
        afterEach(() => {
            COMPLETION_RETRY_DELAYS_MS.splice(0, COMPLETION_RETRY_DELAYS_MS.length, 1500, 4000);
        });

        it('retries a capacity timeout and returns the retried answer', async () => {
            let calls = 0;
            const { client, api } = makeClient(() => {
                calls++;
                return calls <= 2 ? [capacityError] : [cc({ content: 'answer after retry' })];
            });
            const res = await client.chatWithHistory([{ role: Role.User, content: 'do the task' }]);
            expect(res.message.content).toBe('answer after retry');
            expect(api).toHaveBeenCalledTimes(3);
        });

        it('gives up after exhausting the retries', async () => {
            const { client, api } = makeClient(() => [capacityError]);
            await expect(
                client.chatWithHistory([{ role: Role.User, content: 'hi' }]),
            ).rejects.toThrow(/timed out waiting for capacity/u);
            expect(api).toHaveBeenCalledTimes(3);
        });

        it('does not retry once content was already streamed to the client', async () => {
            const { client, api } = makeClient(() => [cc({ content: 'partial' }), capacityError]);
            const chunks: string[] = [];
            await expect(
                client.chatWithHistory([{ role: Role.User, content: 'hi' }], (c) => chunks.push(c)),
            ).rejects.toThrow(/timed out waiting for capacity/u);
            expect(api).toHaveBeenCalledTimes(1);
            expect(chunks.join('')).toBe('partial');
        });

        it('does not retry non-transient errors', async () => {
            const { client, api } = makeClient(() => [{ error: { message: 'API returned error: invalid model' } }]);
            await expect(
                client.chatWithHistory([{ role: Role.User, content: 'hi' }]),
            ).rejects.toThrow(/invalid model/u);
            expect(api).toHaveBeenCalledTimes(1);
        });
    });

    it('sends tier and reasoning_effort in the request body', async () => {
        const { client, api } = makeClient(() => [cc({ content: 'ok' })]);
        await client.chatWithHistory([{ role: Role.User, content: 'hi' }], undefined, {
            modelTier: 'lumo-max', enableReasoning: true,
        });
        const body = api.mock.calls[0][0].data as { model: string; reasoning_effort: string };
        expect(body.model).toBe('lumo-max');
        expect(body.reasoning_effort).toBe('high');
    });
});
