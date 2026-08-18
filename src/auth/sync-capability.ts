import type { StoredTokens } from './types.js';

/**
 * Real Proton user+master keys (not generateLocalKeys).
 * Those are what the spaces API needs; method name is not the gate.
 */
export function hasProtonSyncKeys(
    tokens: Pick<StoredTokens, 'userKeys' | 'masterKeys'>
): boolean {
    const users = tokens.userKeys ?? [];
    const masters = tokens.masterKeys ?? [];
    return (
        users.length > 0 &&
        masters.length > 0 &&
        !users.some((key) => key.isLocalOnly) &&
        !masters.some((key) => key.isLocalOnly)
    );
}

export function isCaptchaAuthError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /captcha|human.?verif|\bhv\b|HV_REQUIRED|HUMAN_VERIFICATION/i.test(message);
}

/** Proton Code 2028: password SRP is blocked. Retrying /auth/v4 will not help; use the browser. */
export function isAbuseAuthError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /Code\s*=\s*2028|appeal-abuse|unusual activity targeting your account/i.test(message);
}
