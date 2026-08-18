import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { writeNewKeyFile, getVaultKey, clearKeyCache } from '../../src/auth/vault/key-provider.js';

describe('writeNewKeyFile', () => {
  const dirs: string[] = [];

  afterEach(() => {
    clearKeyCache();
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('creates a 32-byte key file and getVaultKey can read it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lumo-vault-key-'));
    dirs.push(dir);
    const keyFilePath = join(dir, 'nested', 'vault-key');
    const config = {
      keychain: { service: 'lumo-tamer-test-no-such-service', account: 'vault-key' },
      keyFilePath,
    };

    const created = writeNewKeyFile(config);
    expect(created).toHaveLength(32);
    expect(readFileSync(keyFilePath)).toHaveLength(32);

    clearKeyCache();
    const loaded = await getVaultKey(config);
    expect(loaded.equals(created)).toBe(true);
  });
});
