/**
 * Token Refresh - Shared token refresh logic for SRP and rclone auth methods
 *
 * Both SRP and rclone have refresh tokens that can be used with Proton's
 * /auth/refresh endpoint to obtain new access tokens without re-authentication.
 *
 * Browser auth uses a different cookie-based approach (see BrowserAuthProvider.refresh()).
 */

import { APP_VERSION_HEADER } from '@lumo/config.js';
import { AUTH } from '../app/const.js';
import { PROTON_URLS } from '../app/urls.js';
import { logger } from '../app/logger.js';
import type { StoredTokens } from './types.js';

interface RefreshResponse {
    AccessToken: string;
    RefreshToken: string;
    UID: string;
    ExpiresIn?: number;
}

/**
 * Refresh tokens using Proton's /auth/refresh endpoint (JSON body approach).
 *
 * Works with SRP and rclone auth methods since both store a refreshToken.
 * Browser auth should NOT use this - it has its own cookie-based refresh.
 *
 * @param tokens - Current stored tokens (must include refreshToken)
 * @returns Partial token update with new accessToken, refreshToken, uid, and expiresAt
 * @throws Error if no refresh token or refresh fails
 */
export async function refreshWithRefreshToken(tokens: StoredTokens): Promise<Partial<StoredTokens>> {
    if (!tokens.refreshToken) {
        throw new Error('No refresh token available');
    }

    logger.info({ uid: tokens.uid.slice(0, 8) + '...' }, 'Refreshing tokens via /auth/refresh');

    const response = await fetch(`${PROTON_URLS.ACCOUNT_API}/auth/refresh`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-pm-uid': tokens.uid,
            'x-pm-appversion': APP_VERSION_HEADER,
        },
        body: JSON.stringify({
            UID: tokens.uid,
            RefreshToken: tokens.refreshToken,
            ResponseType: 'token',
            GrantType: 'refresh_token',
            RedirectURI: 'https://protonmail.com',
        }),
    });

    if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        logger.error(
            { status: response.status, body: errorBody.slice(0, 200) },
            'Token refresh failed'
        );
        throw new Error(`Token refresh failed: ${response.status}`);
    }

    const data = await response.json() as RefreshResponse;

    const expiresIn = data.ExpiresIn || AUTH.DEFAULT_ACCESS_TOKEN_TTL_SEC;
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    logger.info(
        { uid: data.UID.slice(0, 8) + '...', expiresIn: `${Math.round(expiresIn / 3600)}h` },
        'Token refresh successful'
    );

    return {
        accessToken: data.AccessToken,
        refreshToken: data.RefreshToken,
        uid: data.UID,
        expiresAt,
    };
}

/**
 * Check if tokens can be refreshed (have a refresh token)
 */
export function canRefreshWithToken(tokens: StoredTokens): boolean {
    return !!tokens.refreshToken;
}

/** Shown on /auth after the vault is dropped because refresh can no longer work. */
export const SESSION_EXPIRED_NOTICE =
    'Proton session expired. Tokens could not be refreshed. Log in again.';

const PERMANENT_REFRESH_STATUS = new Set([400, 401, 403, 422]);

/**
 * Refresh token is gone or Proton rejected it. Retrying will not help; drop the session.
 * Network / 5xx stay transient.
 */
export function isPermanentRefreshFailure(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    if (/No refresh token available|No access token in refresh response/i.test(message)) {
        return true;
    }
    const statusMatch = message.match(/Token refresh failed:\s*(\d{3})/i);
    if (!statusMatch) return false;
    return PERMANENT_REFRESH_STATUS.has(Number(statusMatch[1]));
}
