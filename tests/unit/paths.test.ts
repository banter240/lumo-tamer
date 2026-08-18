import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'path';
import { homedir } from 'os';
import {
  PROJECT_ROOT,
  resolveProjectPath,
  resolveDataPath,
  setDataDir,
  getDataDir,
} from '../../src/app/paths.js';

describe('paths', () => {
  const prevHome = process.env.LUMO_HOME;

  afterEach(() => {
    setDataDir(undefined);
    if (prevHome === undefined) {
      delete process.env.LUMO_HOME;
    } else {
      process.env.LUMO_HOME = prevHome;
    }
  });

  it('resolveProjectPath stays on the install root', () => {
    expect(resolveProjectPath('config.defaults.yaml')).toBe(join(PROJECT_ROOT, 'config.defaults.yaml'));
  });

  it('resolveDataPath follows --home / setDataDir', () => {
    setDataDir('/tmp/lumo-home-test');
    expect(getDataDir()).toBe('/tmp/lumo-home-test');
    expect(resolveDataPath('sessions/vault.enc')).toBe(join('/tmp/lumo-home-test', 'sessions/vault.enc'));
  });

  it('leaves absolute paths alone', () => {
    expect(resolveDataPath('/abs/vault.enc')).toBe('/abs/vault.enc');
  });

  it('expands ~/ via join so Windows separators stay valid', () => {
    expect(resolveDataPath('~/vault.enc')).toBe(join(homedir(), 'vault.enc'));
  });
});
