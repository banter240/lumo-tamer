import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { publish } from '../../scripts/sr-github-release.js';

describe('sr-github-release', () => {
  const calls: Array<{ url: string; method: string }> = [];

  beforeEach(() => {
    calls.length = 0;
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const method = init?.method || 'GET';
      calls.push({ url, method });
      if (method === 'POST' && url.endsWith('/releases')) {
        return new Response(JSON.stringify({ message: 'Validation Failed' }), { status: 422 });
      }
      if (method === 'GET' && url.includes('/releases/tags/')) {
        return new Response(JSON.stringify({ id: 42 }), { status: 200 });
      }
      if (method === 'PATCH' && url.endsWith('/releases/42')) {
        return new Response(JSON.stringify({ html_url: 'https://github.com/o/r/releases/tag/v1' }), { status: 200 });
      }
      return new Response('unexpected', { status: 500 });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('updates an existing GitHub release instead of failing', async () => {
    const result = await publish({}, {
      env: { GITHUB_REPOSITORY: 'banter240/lumo-tamer', GITHUB_TOKEN: 't' },
      logger: { log: () => {} },
      branch: { name: 'dev', prerelease: 'dev' },
      nextRelease: { gitTag: 'v0.7.0-dev.9', notes: 'notes' },
    });
    expect(result.url).toContain('/releases/tag/v1');
    expect(calls.map((c) => c.method)).toEqual(['POST', 'GET', 'PATCH']);
  });
});
