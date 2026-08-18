/**
 * Login page: GET /auth and POST /auth/login validation.
 * Does not call Proton.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import { createAuthRouter } from '../../src/api/routes/auth.js';
import { RequestQueue } from '../../src/api/queue.js';
import { setupAuthMiddleware, setupReadyMiddleware } from '../../src/api/middleware.js';
import { listen, closeServer } from '../helpers/listen.js';

describe('auth page', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use(setupAuthMiddleware('test-key'));
    app.use(setupReadyMiddleware(() => false));
    app.use(createAuthRouter({ queue: new RequestQueue(1) }));
    app.post('/v1/chat/completions', (_req, res) => res.json({ ok: true }));
    ({ server, baseUrl } = await listen(app));
  });

  afterAll(() => closeServer(server));

  it('serves the login page without an API key', async () => {
    const res = await fetch(`${baseUrl}/auth`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/html/);
    const html = await res.text();
    expect(html).toContain('Proton email');
    expect(html).toContain('/auth/login');
    expect(html).toContain('If login fails');
    expect(html).toContain('Docker, no monitor');
    expect(html).toContain('--profile browser');
    expect(html).toContain('autocomplete="one-time-code"');
    expect(html).toContain('id="one-time-code"');
    expect(html).toContain('lumo-tamer-theme');
    expect(html).toContain('themeToggle');
    expect(html).toContain('href="/config"');
    expect(html).toContain('github.com/banter240/lumo-tamer');
  });

  it('accepts logout without an API key', async () => {
    const res = await fetch(`${baseUrl}/auth/logout`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('rejects missing credentials', async () => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: '', password: '' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/required/i);
  });

  it('returns 503 on chat endpoints until logged in', async () => {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-key',
      },
      body: JSON.stringify({ messages: [] }),
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.type).toBe('auth_required');
  });
});
