import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { parse } from 'yaml';
import { setDataDir } from '../../src/app/paths.js';
import { updateAuthConfig } from '../../src/auth/update-config.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'update-config-test-'));
  setDataDir(tmpDir);
});

afterEach(() => {
  setDataDir(undefined);
  rmSync(tmpDir, { recursive: true, force: true });
});

function readYaml(): Record<string, unknown> {
  return parse(readFileSync(join(tmpDir, 'config.yaml'), 'utf8')) as Record<string, unknown>;
}

describe('updateAuthConfig', () => {
  it('writes method, launch: false, and CDP as nested maps (not auth: browser)', () => {
    writeFileSync(join(tmpDir, 'config.yaml'), 'server:\n  apiKey: "secret"\n');

    updateAuthConfig({
      method: 'browser',
      launch: false,
      cdpEndpoint: 'http://browser:9222',
    });

    const raw = readFileSync(join(tmpDir, 'config.yaml'), 'utf8');
    expect(raw).not.toMatch(/^auth:\s*browser\s*$/m);
    expect(raw).toContain('apiKey: "secret"');

    const config = readYaml();
    expect(config).toEqual({
      server: { apiKey: 'secret' },
      auth: {
        method: 'browser',
        browser: {
          launch: false,
          cdpEndpoint: 'http://browser:9222',
        },
      },
    });
  });

  it('turns a scalar auth: browser into a map before writing', () => {
    writeFileSync(join(tmpDir, 'config.yaml'), 'auth: browser\n');

    updateAuthConfig({
      method: 'browser',
      launch: false,
      cdpEndpoint: 'http://browser:9222',
    });

    expect(readYaml()).toEqual({
      auth: {
        method: 'browser',
        browser: {
          launch: false,
          cdpEndpoint: 'http://browser:9222',
        },
      },
    });
  });

  it('writes only method for password login', () => {
    writeFileSync(join(tmpDir, 'config.yaml'), 'server:\n  apiKey: "secret"\n');
    updateAuthConfig({ method: 'login' });

    expect(readYaml()).toEqual({
      server: { apiKey: 'secret' },
      auth: { method: 'login' },
    });
  });
});
