/**
 * Browser Auth Provider
 *
 * Extends AuthProvider with browser-specific cookie-based token refresh.
 * Uses tokens extracted from browser session via Playwright.
 */

import { AUTH } from '../../app/const.js';
import { logger } from '../../app/logger.js';
import { APP_VERSION_HEADER } from '@lumo/config.js';
import { PROTON_URLS } from '../../app/urls.js';
import { AuthProvider, registerBrowserProvider, type ProviderConfig } from './provider.js';
import type { StoredTokens } from '../types.js';

interface RefreshResponse {
    UID: string;
    ExpiresIn?: number;
    AccessToken?: string;
    RefreshToken?: string;
}

function readSetCookieHeaders(response: Response): string[] {
    if (typeof response.headers.getSetCookie === 'function') {
        const list = response.headers.getSetCookie();
        if (list.length > 0) return list;
    }
    const single = response.headers.get('set-cookie');
    return single ? [single] : [];
}

export class BrowserAuthProvider extends AuthProvider {
    constructor(tokens: StoredTokens, config: ProviderConfig) {
        super(tokens, config);
    }

    /**
     * Browser-specific token refresh using cookie-based approach.
     *
     * Unlike SRP/rclone which use JSON body, browser auth must send the refresh
     * token as a cookie and parse new tokens from Set-Cookie response headers.
     */
    override async refresh(): Promise<void> {
        if (!this.tokens.refreshToken) {
            throw new Error('No refresh token available');
        }

        const baseUrl = PROTON_URLS.LUMO_API;
        const clientId = 'WebLumo';

        // Reconstruct the REFRESH cookie value as the browser would send it
        const refreshCookieValue = encodeURIComponent(JSON.stringify({
            ResponseType: 'token',
            ClientID: clientId,
            GrantType: 'refresh_token',
            RefreshToken: this.tokens.refreshToken,
            UID: this.tokens.uid,
        }));
        const refreshCookie = `REFRESH-${this.tokens.uid}=${refreshCookieValue}`;

        logger.info({
            uid: this.tokens.uid.slice(0, 8) + '...',
            clientId,
            baseUrl,
        }, 'Refreshing browser tokens via /auth/refresh (cookie-based)');

        const response = await fetch(`${baseUrl}/auth/refresh`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-pm-uid': this.tokens.uid,
                'x-pm-appversion': APP_VERSION_HEADER,
                'Cookie': refreshCookie,
            },
        });

        if (!response.ok) {
            const errorBody = await response.text().catch(() => '');
            logger.error(
                { status: response.status, body: errorBody.slice(0, 200) },
                'Browser token refresh failed'
            );
            throw new Error(`Token refresh failed: ${response.status}`);
        }

        // Parse tokens from Set-Cookie headers (Node: getSetCookie; some runtimes only expose one header)
        const setCookieHeaders = readSetCookieHeaders(response);
        logger.debug({ setCookieHeaders }, 'Refresh response cookies');

        let newAccessToken: string | undefined;
        let newRefreshToken: string | undefined;

        for (const cookie of setCookieHeaders) {
            // AUTH-{uid}=<accessToken>; ...
            const authMatch = cookie.match(/^AUTH-[^=]+=([^;]+)/);
            if (authMatch) {
                newAccessToken = authMatch[1];
            }

            // REFRESH-{uid}=<url-encoded json>; ...
            const refreshMatch = cookie.match(/^REFRESH-[^=]+=([^;]+)/);
            if (refreshMatch) {
                try {
                    const decoded = JSON.parse(decodeURIComponent(refreshMatch[1]));
                    newRefreshToken = decoded.RefreshToken;
                } catch {
                    logger.warn({ cookie: refreshMatch[1].slice(0, 50) }, 'Failed to parse REFRESH cookie');
                }
            }
        }

        const data = await response.json() as RefreshResponse;
        if (!newAccessToken && data.AccessToken) {
            newAccessToken = data.AccessToken;
            newRefreshToken = data.RefreshToken || newRefreshToken;
            logger.info('Browser refresh used JSON body (no AUTH cookie on the response)');
        }

        if (!newAccessToken) {
            logger.error({
                data,
                setCookieCount: setCookieHeaders.length,
            }, 'No access token in refresh response cookies or JSON');
            throw new Error('No access token in refresh response');
        }

        const expiresIn = data.ExpiresIn || AUTH.DEFAULT_ACCESS_TOKEN_TTL_SEC;

        // Update tokens
        this.tokens = {
            ...this.tokens,
            accessToken: newAccessToken,
            refreshToken: newRefreshToken || this.tokens.refreshToken,
            uid: data.UID || this.tokens.uid,
            expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
            extractedAt: new Date().toISOString(), // Reset age on refresh
        };

        await this.saveTokensToVault();

        logger.info({
            method: this.method,
            uid: this.tokens.uid.slice(0, 8) + '...',
            expiresIn: `${Math.round(expiresIn / 3600)}h`,
        }, 'Browser token refresh successful');
    }
}

// Register this provider with the factory
registerBrowserProvider((tokens, config) => new BrowserAuthProvider(tokens, config));
