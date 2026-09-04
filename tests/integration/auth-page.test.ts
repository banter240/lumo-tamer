/**
 * Login page: GET /auth and POST /auth/login validation.
 * Does not call Proton.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import { createAuthRouter } from '../../src/api/routes/auth.js';
import { SESSION_EXPIRED_NOTICE } from '../../src/auth/token-refresh.js';
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
    expect(html).toContain('Docker / Portainer');
    expect(html).toContain('--profile browser');
    expect(html).toContain('auth browser');
    expect(html).toContain('http://browser:9222');
    expect(html).toContain('launch: false');
    expect(html).toContain('rm -f browser');
    expect(html).toContain("docker rmi $(docker images -q --filter reference='*lumo-tamer*browser*')");
    expect(html).toContain('browser-data');
    expect(html).toContain('lumo-tamer-browser');
    expect(html).toContain('port 3003');
    expect(html).not.toContain('playwright install');
    expect(html).toContain('autocomplete="one-time-code"');
    expect(html).toContain('id="one-time-code"');
    expect(html).toContain('lumo-tamer-theme');
    expect(html).toContain('themeToggle');
    expect(html).toContain('href="/config"');
    expect(html).toContain('id="updateChip"');
    expect(html).toContain('>Updates</button>');
    expect(html).toContain('/v1/update?refresh=1');
    expect(html).toContain('github.com/banter240/lumo-tamer');
  });

  it('shows a re-login notice instead of the signed-in card when the session expired', async () => {
    const expired = express();
    expired.use(express.json());
    expired.use(createAuthRouter({ queue: new RequestQueue(1) }, {
      getSessionNotice: () => SESSION_EXPIRED_NOTICE,
    }));
    const { server, baseUrl } = await listen(expired);
    try {
      const res = await fetch(`${baseUrl}/auth`);
      const html = await res.text();
      expect(html).toContain(SESSION_EXPIRED_NOTICE);
      expect(html).toContain('Log in again to restore Lumo');
      expect(html).toContain('Proton email');
      expect(html).not.toContain('Signed in');
      expect(html).not.toContain('Lumo API Ready');
    } finally {
      await closeServer(server);
    }
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
