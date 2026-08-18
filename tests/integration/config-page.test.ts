import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createConfigRouter } from '../../src/api/routes/config.js';
import { setupAuthMiddleware, setupReadyMiddleware } from '../../src/api/middleware.js';
import { setDataDir } from '../../src/app/paths.js';
import { listen, closeServer } from '../helpers/listen.js';

describe('config page', () => {
  let server: Server;
  let baseUrl: string;
  let tmpDir: string;
  let saved = false;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'lumo-config-ui-'));
    setDataDir(tmpDir);
    const app = express();
    app.use(express.json());
    app.use(setupAuthMiddleware('test-key'));
    app.use(setupReadyMiddleware(() => false));
    app.use(createConfigRouter({ onSaved: () => { saved = true; } }));
    ({ server, baseUrl } = await listen(app));
  });

  afterAll(async () => {
    await closeServer(server);
    setDataDir(undefined);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    saved = false;
    writeFileSync(join(tmpDir, 'config.yaml'), [
      'server:',
      '  apiKey: "super-secret-key"',
      '  enableWebSearch: false',
      '',
    ].join('\n'));
  });

  afterEach(() => {
    saved = false;
  });

  it('serves the form without an API key', async () => {
    const res = await fetch(`${baseUrl}/config`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/html/);
    const html = await res.text();
    expect(html).toContain('leave blank to keep');
    expect(html).toContain('Advanced');
    expect(html).toContain('data-help');
    expect(html).toContain('extraBlock');
    expect(html).toContain('field.examples');
    expect(html).toContain('data-copy');
    expect(html).toContain('waitUntilUp');
    expect(html).toContain("location.reload()");
    expect(html).toContain('lumo-tamer-theme');
    expect(html).toContain('btn-default');
    expect(html).toContain('data-undo');
    expect(html).toContain("field.kind !== 'secret'");
    expect(html).toContain('data-cat');
    expect(html).toContain('href="/auth"');
    expect(html).toContain('github.com/banter240/lumo-tamer');
    expect(html).toContain('Reset to defaults');
    expect(html).toContain('resetAll: true');
    expect(html).toContain('The API key is kept');
    expect(html).not.toContain('super-secret-key');
  });

  it('never returns the API key', async () => {
    const res = await fetch(`${baseUrl}/v1/config`);
    expect(res.status).toBe(200);
    const body = await res.json();
    const dumped = JSON.stringify(body);
    expect(dumped).not.toContain('super-secret-key');
    const key = body.fields.find((f: { path: string }) => f.path === 'server.apiKey');
    expect(key.kind).toBe('secret');
    expect(key.value).toBeNull();
    expect(body.current.server.apiKey).toBeNull();
  });

  it('saves a toggle and keeps the existing API key', async () => {
    const res = await fetch(`${baseUrl}/v1/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changes: { 'server.enableWebSearch': true, 'server.apiKey': '' } }),
    });
    expect(res.status).toBe(200);
    const yaml = readFileSync(join(tmpDir, 'config.yaml'), 'utf8');
    expect(yaml).toContain('enableWebSearch: true');
    expect(yaml).toContain('super-secret-key');
    expect(saved).toBe(true);
  });

  it('resets every override except the API key', async () => {
    writeFileSync(join(tmpDir, 'config.yaml'), [
      'server:',
      '  apiKey: "super-secret-key"',
      '  port: 9999',
      '  enableWebSearch: true',
      'conversations:',
      '  enableSync: true',
      '',
    ].join('\n'));

    const res = await fetch(`${baseUrl}/v1/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resetAll: true }),
    });
    expect(res.status).toBe(200);
    const yaml = readFileSync(join(tmpDir, 'config.yaml'), 'utf8');
    expect(yaml).toContain('super-secret-key');
    expect(yaml).not.toContain('9999');
    expect(yaml).not.toContain('enableWebSearch');
    expect(yaml).not.toContain('enableSync');
    expect(saved).toBe(true);
  });
});
