/**
 * Wrapper for calling the proton-auth Go binary
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { authConfig } from '../../app/config.js';
import type { SRPAuthResult } from './types.js';

export class ProtonAuthError extends Error {
    readonly errorCode?: number;

    constructor(message: string, errorCode?: number) {
        super(message);
        this.name = 'ProtonAuthError';
        this.errorCode = errorCode;
    }
}

export interface ProtonAuthCredentials {
    username: string;
    password: string;
    totp?: string;
}

export function buildProtonAuthEnv(
    credentials?: ProtonAuthCredentials
): NodeJS.ProcessEnv {
    if (!credentials) {
        return process.env;
    }
    return {
        ...process.env,
        PROTON_USERNAME: credentials.username,
        PROTON_PASSWORD: credentials.password,
        ...(credentials.totp ? { PROTON_TOTP: credentials.totp } : {}),
    };
}

/**
 * Run the proton-auth Go binary to perform SRP authentication.
 * Interactive unless credentials are provided (WebUI / non-TTY).
 *
 * @param binaryPath - Path to the proton-auth binary
 * @param outputPath - Optional path to write the auth result JSON
 * @param credentials - Optional non-interactive credentials (passed via env)
 * @param appVersion - X-Pm-AppVersion (default: config login.appVersion)
 * @returns Promise resolving to the auth result
 */
export async function runProtonAuth(
    binaryPath: string,
    outputPath?: string,
    credentials?: ProtonAuthCredentials,
    appVersion?: string
): Promise<SRPAuthResult> {
    // Verify binary exists
    if (!existsSync(binaryPath)) {
        throw new Error(
            `proton-auth binary not found at ${binaryPath}. ` +
            `Build it with: npm run build:login`
        );
    }

    return new Promise((resolve, reject) => {
        const args: string[] = [];

        if (outputPath) {
            args.push('-o', outputPath);
        }

        args.push('--app-version', appVersion ?? authConfig.login.appVersion);
        args.push('--user-agent', authConfig.login.userAgent);

        const interactive = !credentials;
        const proc = spawn(binaryPath, args, {
            stdio: interactive ? ['inherit', 'pipe', 'inherit'] : ['ignore', 'pipe', 'pipe'],
            env: buildProtonAuthEnv(credentials),
        });

        let stdout = '';
        let stderr = '';

        proc.stdout?.on('data', (data) => {
            stdout += data.toString();
        });
        proc.stderr?.on('data', (data) => {
            stderr += data.toString();
        });

        proc.on('error', (err) => {
            reject(new Error(`Failed to spawn proton-auth: ${err.message}`));
        });

        proc.on('close', (code) => {
            if (code !== 0 && !stdout.trim()) {
                const detail = stderr.trim().split('\n').pop() || `exited with code ${code}`;
                reject(new ProtonAuthError(`Authentication failed: ${detail}`));
                return;
            }

            try {
                // If outputPath was specified, stdout might be empty
                // because JSON goes to file. In that case, return success.
                if (outputPath && !stdout.trim()) {
                    // Read from the output file would happen in auth-manager
                    resolve({
                        accessToken: '',
                        refreshToken: '',
                        uid: '',
                        userID: '',
                        keyPassword: '',
                    });
                    return;
                }

                const result = JSON.parse(stdout) as SRPAuthResult;

                if (result.error) {
                    reject(new ProtonAuthError(result.error, result.errorCode));
                    return;
                }

                resolve(result);
            } catch (parseErr) {
                reject(new Error(`Failed to parse auth result: ${parseErr}`));
            }
        });
    });
}
