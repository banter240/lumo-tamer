/**
 * Login page: GET /auth and POST /auth/login validation.
 * Does not call Proton.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { createAuthRouter } from '../../src/api/routes/auth.js';
import { RequestQueue } from '../../src/api/queue.js';
import { setupAuthMiddleware, setupReadyMiddleware } from '../../src/api/middleware.js';

function listen(app: express.Express): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

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
