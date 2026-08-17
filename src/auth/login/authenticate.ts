/**
 * Login Authentication Entry Point
 *
 * Run interactive login using username/password credentials.
 * Used by CLI (tamer auth) and the /auth WebUI.
 */

import { authConfig } from '../../app/config.js';
import { logger } from '../../app/logger.js';
import { resolveProjectPath } from '../../app/paths.js';
import { APP_VERSION_HEADER } from '@lumo/config.js';
import { runProtonAuth, type ProtonAuthCredentials } from './proton-auth-cli.js';
import type { SRPAuthResult } from './types.js';
import { writeVault, type VaultKeyConfig } from '../vault/index.js';
import { createProtonApi } from '../api-factory.js';
import { fetchKeys, type FetchedKeys } from '../fetch-keys.js';
import { hasProtonSyncKeys, isCaptchaAuthError } from '../sync-capability.js';
import type { StoredTokens } from '../types.js';

export type { ProtonAuthCredentials };

export interface LoginAuthenticationResult {
    sync: boolean;
}

export async function loginWithLumoScope(
    binaryPath: string,
    credentials?: ProtonAuthCredentials
): Promise<SRPAuthResult> {
    const fallbackVersion = authConfig.login.appVersion;
    try {
        return await runProtonAuth(binaryPath, undefined, credentials, APP_VERSION_HEADER);
    } catch (error) {
        if (fallbackVersion !== APP_VERSION_HEADER && isCaptchaAuthError(error)) {
            logger.warn('Lumo-scoped login hit CAPTCHA, retrying with configured app version (chat only)');
            return await runProtonAuth(binaryPath, undefined, credentials, fallbackVersion);
        }
        throw error;
    }
}

export async function tokensFromLoginResult(
    result: SRPAuthResult,
    fetched: FetchedKeys
): Promise<StoredTokens> {
    const tokens: StoredTokens = {
        method: 'login',
        uid: result.uid,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        keyPassword: result.keyPassword,
        expiresAt: result.expiresAt || new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
        extractedAt: new Date().toISOString(),
        userKeys: fetched.userKeys,
        masterKeys: fetched.masterKeys,
    };

    if (!hasProtonSyncKeys(tokens) && tokens.keyPassword) {
        const { generateLocalKeys } = await import('../key-generator.js');
        const generated = await generateLocalKeys(tokens.keyPassword);
        tokens.userKeys = generated.userKeys;
        tokens.masterKeys = generated.masterKeys;
        logger.info('Generated local encryption keys (sync disabled)');
    }

    return tokens;
}

/**
 * Run login authentication and save tokens to the vault.
 * Tries Lumo-scoped SRP first so conversation sync works; CAPTCHA falls back
 * to the configured Drive/rclone app version (chat only).
 */
export async function runLoginAuthentication(
    credentials?: ProtonAuthCredentials
): Promise<LoginAuthenticationResult> {
    const binaryPath = resolveProjectPath(authConfig.login.binaryPath);
    const result = await loginWithLumoScope(binaryPath, credentials);

    const api = createProtonApi({
        uid: result.uid,
        accessToken: result.accessToken,
    });
    const fetched = await fetchKeys(api);
    const tokens = await tokensFromLoginResult(result, fetched);

    const vaultPath = resolveProjectPath(authConfig.vault.path);
    const keyConfig: VaultKeyConfig = {
        keychain: authConfig.vault.keychain,
        keyFilePath: authConfig.vault.keyFilePath,
    };
    await writeVault(vaultPath, tokens, keyConfig);

    const sync = hasProtonSyncKeys(tokens);
    logger.info({ vaultPath, sync }, 'Tokens saved to encrypted vault');
    logger.info({
        uid: tokens.uid.slice(0, 12) + '...',
        hasKeyPassword: !!tokens.keyPassword,
        expiresAt: tokens.expiresAt,
        sync,
    }, 'Login authentication complete');

    return { sync };
}
