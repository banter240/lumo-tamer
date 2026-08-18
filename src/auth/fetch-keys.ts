/**
 * Fetch user and master keys using an authenticated ProtonApi.
 * Used after password login when SRP was done as web-lumo (Lumo scope).
 * Browser auth still extracts keys via the page context instead.
 */
import { logger } from '../app/logger.js';
import type { ProtonApi, CachedUserKey, CachedMasterKey } from './types.js';

export interface FetchedKeys {
    userKeys?: CachedUserKey[];
    masterKeys?: CachedMasterKey[];
}

/**
 * Fetch user keys and master keys from Proton API.
 * Errors are caught and logged - partial results may be returned.
 */
export async function fetchKeys(protonApi: ProtonApi): Promise<FetchedKeys> {
    const result: FetchedKeys = {};

    // Fetch user keys from /core/v4/users
    try {
        const userResponse = await protonApi({ url: 'core/v4/users', method: 'get' }) as {
            User: {
                Keys: Array<{
                    ID: string;
                    PrivateKey: string;
                    Primary: number;
                    Active: number;
                }>;
            };
        };
        result.userKeys = userResponse.User.Keys.map((k) => ({
            ID: k.ID,
            PrivateKey: k.PrivateKey,
            Primary: k.Primary,
            Active: k.Active,
        }));
        logger.info({ count: result.userKeys.length }, 'Fetched user keys');
    } catch (err) {
        logger.warn({ err }, 'Failed to fetch user keys - may have scope issues');
    }

    // Fetch master keys from /lumo/v1/masterkeys
    try {
        const masterKeysResponse = await protonApi({ url: 'lumo/v1/masterkeys', method: 'get' }) as {
            MasterKeys: CachedMasterKey[];
        };
        result.masterKeys = masterKeysResponse.MasterKeys;
        logger.info({ count: result.masterKeys.length }, 'Fetched master keys');
    } catch (err) {
        logger.warn({ err }, 'Failed to fetch master keys - may have scope issues');
    }

    return result;
}
