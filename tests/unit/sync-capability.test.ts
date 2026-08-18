import { describe, it, expect } from 'vitest';
import { hasProtonSyncKeys, isCaptchaAuthError, isAbuseAuthError } from '../../src/auth/sync-capability.js';
import { isLumoAppUrl } from '../../src/auth/browser/authenticate.js';
import { tokensFromLoginResult } from '../../src/auth/login/authenticate.js';
import { AuthProvider } from '../../src/auth/providers/provider.js';
import type { StoredTokens } from '../../src/auth/types.js';

const protonUserKey = {
  ID: 'user-1',
  PrivateKey: '-----BEGIN PGP PRIVATE KEY BLOCK-----',
  Primary: 1,
  Active: 1,
};

const protonMasterKey = {
  ID: 'master-1',
  MasterKey: 'abc',
  IsLatest: true,
  Version: 1,
};

const localUserKey = { ...protonUserKey, isLocalOnly: true };
const localMasterKey = { ...protonMasterKey, isLocalOnly: true };

describe('hasProtonSyncKeys', () => {
  it('is true only when both key sets are real Proton keys', () => {
    expect(hasProtonSyncKeys({ userKeys: [protonUserKey], masterKeys: [protonMasterKey] })).toBe(true);
    expect(hasProtonSyncKeys({ userKeys: [localUserKey], masterKeys: [localMasterKey] })).toBe(false);
    expect(hasProtonSyncKeys({ userKeys: [protonUserKey], masterKeys: [] })).toBe(false);
  });
});

describe('isCaptchaAuthError', () => {
  it('detects human verification errors', () => {
    expect(isCaptchaAuthError(new Error('CAPTCHA required'))).toBe(true);
    expect(isCaptchaAuthError(new Error('HUMAN_VERIFICATION_REQUIRED'))).toBe(true);
    expect(isCaptchaAuthError(new Error('Invalid username or password'))).toBe(false);
  });
});

describe('isLumoAppUrl', () => {
  it('rejects guest and login shells, accepts the Lumo app', () => {
    expect(isLumoAppUrl('https://lumo.proton.me/u/abc/guest')).toBe(false);
    expect(isLumoAppUrl('https://account.proton.me/login')).toBe(false);
    expect(isLumoAppUrl('https://lumo.proton.me/')).toBe(false);
    expect(isLumoAppUrl('https://lumo.proton.me/u/abc/')).toBe(true);
    expect(isLumoAppUrl('https://lumo.proton.me/chat')).toBe(true);
  });
});

describe('isAbuseAuthError', () => {
  it('detects Proton 2028 password lock', () => {
    expect(isAbuseAuthError(new Error(
      'Authentication failed: unusual activity targeting your account. https://proton.me/support/appeal-abuse (Code=2028, Status=422)'
    ))).toBe(true);
    expect(isAbuseAuthError(new Error('Invalid username or password'))).toBe(false);
    expect(isCaptchaAuthError(new Error('Code=2028, Status=422'))).toBe(false);
  });
});

describe('tokensFromLoginResult', () => {
  const srp = {
    uid: 'uid-1',
    accessToken: 'at',
    refreshToken: 'rt',
    userID: 'user',
    keyPassword: 'kp',
    expiresAt: '2099-01-01T00:00:00.000Z',
  };

  it('keeps fetched Proton keys so sync can turn on', async () => {
    const tokens = await tokensFromLoginResult(srp, {
      userKeys: [protonUserKey],
      masterKeys: [protonMasterKey],
    });
    expect(hasProtonSyncKeys(tokens)).toBe(true);
    expect(tokens.userKeys?.[0].ID).toBe('user-1');
  });

  it('generates local keys when fetch returned nothing', async () => {
    const tokens = await tokensFromLoginResult(srp, {});
    expect(hasProtonSyncKeys(tokens)).toBe(false);
    expect(tokens.userKeys?.[0].isLocalOnly).toBe(true);
  });
});

describe('AuthProvider.supportsFullApi', () => {
  const config = {
    vaultPath: '/tmp/vault.enc',
    keyConfig: { keychain: { service: 't', account: 't' }, keyFilePath: '' },
  };

  function provider(partial: Partial<StoredTokens>): AuthProvider {
    const tokens: StoredTokens = {
      method: 'login',
      uid: 'uid',
      accessToken: 'at',
      extractedAt: new Date().toISOString(),
      ...partial,
    };
    return new AuthProvider(tokens, config);
  }

  it('is true for browser sessions', () => {
    expect(provider({ method: 'browser' }).supportsFullApi()).toBe(true);
  });

  it('is true for login with Proton keys', () => {
    expect(provider({
      userKeys: [protonUserKey],
      masterKeys: [protonMasterKey],
    }).supportsFullApi()).toBe(true);
  });

  it('is false for login with local-only keys', () => {
    expect(provider({
      userKeys: [localUserKey],
      masterKeys: [localMasterKey],
    }).supportsFullApi()).toBe(false);
  });
});
