/**
 * API Factory - Creates ProtonApi functions for all auth methods
 *
 * Supports automatic 401 retry with token refresh via onAuthError callback.
 */

import type { ProtonApi, ProtonApiError, ProtonApiOptions } from '../lumo-client/types.js';
import { APP_VERSION_HEADER } from '@lumo/config.js';
import { PROTON_URLS } from '../app/urls.js';
import { logger } from '../app/logger.js';
import { getMetrics } from '../app/metrics.js';
import { dumpProtonApiCall } from '../app/api-dump.js';

function decodeProtonErrorBody(errorBody: string): {
    message?: string;
    Code?: number;
    data?: unknown;
} {
    try {
        const data = JSON.parse(errorBody) as {
            Error?: string;
            Code?: number;
            error?: { message?: string };
        };
        return {
            data,
            message: data.Error || data.error?.message,
            Code: data.Code,
        };
    } catch {
        return {};
    }
}

export interface ApiFactoryOptions {
    uid: string;
    accessToken: string;
    /** Cookie header string for browser auth (optional) */
    cookies?: string;
    /**
     * Callback invoked on 401 errors to refresh tokens.
     * Should return new credentials, or null if refresh failed.
     * If provided and returns new credentials, the request will be retried once.
     */
    onAuthError?: () => Promise<{ uid: string; accessToken: string } | null>;
}

/**
 * Create a ProtonApi function for making authenticated API calls
 *
 * @param options - UID, access token, optional cookies, and optional auth error handler
 * @returns ProtonApi function
 */
export function createProtonApi(options: ApiFactoryOptions): ProtonApi {
    let { uid, accessToken } = options;
    const { cookies, onAuthError } = options;
    const baseUrl = PROTON_URLS.LUMO_API;

    /**
     * Update credentials after a refresh
     * Called by AuthManager when tokens are refreshed
     */
    const updateCredentials = (newUid: string, newAccessToken: string) => {
        uid = newUid;
        accessToken = newAccessToken;
    };

    // Attach updateCredentials to the api function for external access
    const api = async function api(apiOptions: ProtonApiOptions): Promise<ReadableStream<Uint8Array> | unknown> {
        const { url, method, data, signal, output = 'json' } = apiOptions;
        const startTime = Date.now();

        const fullUrl = url.startsWith('http') ? url : `${baseUrl}/${url}`;

        const recordMetrics = (status: number) => {
            const durationSeconds = (Date.now() - startTime) / 1000;
            const endpoint = url.split('?')[0]; // Strip query params
            const metrics = getMetrics();
            metrics?.protonApiRequestsTotal.inc({
                endpoint,
                method: method.toUpperCase(),
                status: String(status),
            });
            metrics?.protonApiRequestDuration.observe(
                { endpoint, method: method.toUpperCase() },
                durationSeconds
            );
        };

        const makeRequest = async (currentUid: string, currentAccessToken: string): Promise<Response> => {
            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                'x-pm-uid': currentUid,
                'x-pm-appversion': APP_VERSION_HEADER,
                'Authorization': `Bearer ${currentAccessToken}`,
            };

            // Add cookies for browser auth
            if (cookies) {
                headers['Cookie'] = cookies;
            }

            // Add streaming accept header
            if (output === 'stream') {
                headers['Accept'] = 'text/event-stream';
            }

            const fetchOptions: RequestInit = {
                method: method.toUpperCase(),
                headers,
                signal,
            };

            if (data && method !== 'get') {
                fetchOptions.body = JSON.stringify(data);
            }

            return fetch(fullUrl, fetchOptions);
        };

        let response = await makeRequest(uid, accessToken);

        // Handle 401 with retry if onAuthError callback is provided
        if (response.status === 401 && onAuthError) {
            logger.info({ url }, 'Got 401, attempting token refresh...');

            try {
                const newCredentials = await onAuthError();

                if (newCredentials) {
                    // Update stored credentials
                    uid = newCredentials.uid;
                    accessToken = newCredentials.accessToken;

                    // Retry the request with new credentials
                    logger.info({ url }, 'Retrying request with refreshed tokens');
                    response = await makeRequest(uid, accessToken);
                } else {
                    logger.warn('Token refresh returned null - not retrying');
                }
            } catch (refreshError) {
                logger.error({ error: refreshError }, 'Token refresh failed');
                // Fall through to throw the original 401 error
            }
        }

        // Record metrics for the final response
        recordMetrics(response.status);

        if (!response.ok) {
            const errorBody = await response.text().catch(() => '');
            const decoded = decodeProtonErrorBody(errorBody);
            const error = new Error(
                decoded.message
                    || `API error: ${response.status} ${response.statusText}`
            ) as ProtonApiError;
            error.status = response.status;
            error.Code = decoded.Code;
            error.data = decoded.data;
            error.body = errorBody;

            const messages = data && typeof data === 'object'
                ? (data as { messages?: unknown; model?: unknown }).messages
                : undefined;
            logger.error({
                error,
                url,
                method: method.toUpperCase(),
                model: data && typeof data === 'object' ? (data as { model?: unknown }).model : undefined,
                messageCount: Array.isArray(messages) ? messages.length : undefined,
            }, 'Proton API error');
            dumpProtonApiCall({
                method: method.toUpperCase(),
                url,
                status: response.status,
                request: data,
                response: decoded.data ?? errorBody,
            });
            throw error;
        }

        if (output === 'stream') {
            if (!response.body) {
                throw new Error('Expected streaming response but got no body');
            }
            dumpProtonApiCall({
                method: method.toUpperCase(),
                url,
                status: response.status,
                request: data,
                stream: true,
            });
            return response.body;
        }

        const json = await response.json();
        dumpProtonApiCall({
            method: method.toUpperCase(),
            url,
            status: response.status,
            request: data,
            response: json,
        });
        return json;
    } as ProtonApi & { updateCredentials: typeof updateCredentials };

    // Attach updateCredentials method
    api.updateCredentials = updateCredentials;

    return api;
}

/**
 * Type for ProtonApi with updateCredentials method
 */
export type ProtonApiWithRefresh = ProtonApi & {
    updateCredentials: (uid: string, accessToken: string) => void;
};
