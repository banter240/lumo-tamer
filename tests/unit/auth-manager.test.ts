import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { AuthManager, MAX_CONSECUTIVE_REFRESH_FAILURES } from '../../src/auth/manager.js';
import { SESSION_EXPIRED_NOTICE } from '../../src/auth/token-refresh.js';
import type { IAuthProvider } from '../../src/auth/types.js';

function fakeProvider(refresh: () => Promise<void>): IAuthProvider {
  return {
    method: 'login',
    getUid: () => 'uid-1',
    getAccessToken: () => 'at',
    getKeyPassword: () => undefined,
    createApi: () => (async () => ({})) as IAuthProvider['createApi'],
    isValid: () => true,
    getStatus: () => ({
      method: 'login',
      source: 'test',
      valid: true,
      details: {},
      warnings: [],
    }),
    refresh,
    supportsPersistence: () => false,
    supportsFullApi: () => false,
    getUserId: () => undefined,
  };
}

let tmpDir: string;
let vaultPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'auth-manager-'));
  vaultPath = join(tmpDir, 'vault.enc');
  writeFileSync(vaultPath, 'vault');
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('AuthManager.refreshNow', () => {
  it('deletes the vault and notifies on a permanent refresh failure', async () => {
    const onSessionInvalid = vi.fn();
    const manager = new AuthManager({
      provider: fakeProvider(async () => {
        throw new Error('Token refresh failed: 401');
      }),
      vaultPath,
      autoRefresh: { enabled: false },
      onSessionInvalid,
    });

    await expect(manager.refreshNow()).rejects.toThrow(/401/);
    expect(existsSync(vaultPath)).toBe(false);
    expect(onSessionInvalid).toHaveBeenCalledWith(SESSION_EXPIRED_NOTICE);
    expect(manager.getHealth().valid).toBe(false);
  });

  it('keeps the vault after a single transient failure', async () => {
    const onSessionInvalid = vi.fn();
    const manager = new AuthManager({
      provider: fakeProvider(async () => {
        throw new Error('Token refresh failed: 503');
      }),
      vaultPath,
      autoRefresh: { enabled: false },
      onSessionInvalid,
    });

    await expect(manager.refreshNow()).rejects.toThrow(/503/);
    expect(existsSync(vaultPath)).toBe(true);
    expect(onSessionInvalid).not.toHaveBeenCalled();
    expect(manager.getHealth().consecutiveFailures).toBe(1);
    expect(manager.getHealth().valid).toBe(true);
  });

  it('drops the session after too many transient failures', async () => {
    const onSessionInvalid = vi.fn();
    const manager = new AuthManager({
      provider: fakeProvider(async () => {
        throw new Error('Token refresh failed: 503');
      }),
      vaultPath,
      autoRefresh: { enabled: false },
      onSessionInvalid,
    });

    for (let i = 0; i < MAX_CONSECUTIVE_REFRESH_FAILURES - 1; i++) {
      await expect(manager.refreshNow()).rejects.toThrow(/503/);
    }
    expect(onSessionInvalid).not.toHaveBeenCalled();

    await expect(manager.refreshNow()).rejects.toThrow(/503/);
    expect(onSessionInvalid).toHaveBeenCalledTimes(1);
    expect(existsSync(vaultPath)).toBe(false);
  });
});
