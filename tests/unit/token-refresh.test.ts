import { describe, it, expect } from 'vitest';
import { isPermanentRefreshFailure, SESSION_EXPIRED_NOTICE } from '../../src/auth/token-refresh.js';
import { isRecoverableAuthError } from '../../src/app/index.js';

describe('isPermanentRefreshFailure', () => {
  it('treats Proton auth rejections as permanent', () => {
    expect(isPermanentRefreshFailure(new Error('Token refresh failed: 401'))).toBe(true);
    expect(isPermanentRefreshFailure(new Error('Token refresh failed: 422'))).toBe(true);
    expect(isPermanentRefreshFailure(new Error('Token refresh failed: 403'))).toBe(true);
    expect(isPermanentRefreshFailure(new Error('Token refresh failed: 400'))).toBe(true);
    expect(isPermanentRefreshFailure(new Error('No refresh token available'))).toBe(true);
    expect(isPermanentRefreshFailure(new Error('No access token in refresh response'))).toBe(true);
  });

  it('treats network and 5xx as transient', () => {
    expect(isPermanentRefreshFailure(new Error('Token refresh failed: 503'))).toBe(false);
    expect(isPermanentRefreshFailure(new Error('Token refresh failed: 500'))).toBe(false);
    expect(isPermanentRefreshFailure(new Error('fetch failed'))).toBe(false);
  });
});

describe('isRecoverableAuthError', () => {
  it('lets the server stay up when refresh is dead so /auth can re-login', () => {
    expect(isRecoverableAuthError(new Error('Token refresh failed: 401'))).toBe(true);
    expect(isRecoverableAuthError(new Error('No refresh token available'))).toBe(true);
    expect(isRecoverableAuthError(new Error('Vault not found: /x'))).toBe(true);
    expect(isRecoverableAuthError(new Error('ECONNREFUSED'))).toBe(false);
  });
});

describe('SESSION_EXPIRED_NOTICE', () => {
  it('tells the operator to log in again', () => {
    expect(SESSION_EXPIRED_NOTICE).toMatch(/session expired/i);
    expect(SESSION_EXPIRED_NOTICE).toMatch(/Log in again/);
  });
});
