import { describe, it, expect } from 'vitest';
import { buildProtonAuthEnv } from '../../src/auth/login/proton-auth-cli.js';

describe('buildProtonAuthEnv', () => {
  it('returns process.env when no credentials are passed', () => {
    expect(buildProtonAuthEnv()).toBe(process.env);
  });

  it('passes credentials via env, not argv', () => {
    const env = buildProtonAuthEnv({
      username: 'user@example.com',
      password: 'secret',
      totp: '123456',
    });
    expect(env.PROTON_USERNAME).toBe('user@example.com');
    expect(env.PROTON_PASSWORD).toBe('secret');
    expect(env.PROTON_TOTP).toBe('123456');
  });

  it('omits TOTP when not provided', () => {
    const env = buildProtonAuthEnv({
      username: 'user@example.com',
      password: 'secret',
    });
    expect(env.PROTON_TOTP).toBeUndefined();
  });
});
