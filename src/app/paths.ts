/**
 * Path resolution utilities
 *
 * Bundled files (defaults, Go binary) resolve against the install / project root.
 * User files (config.yaml, vault, sessions, logs) resolve against the data dir:
 * `--home`, then LUMO_HOME, then the project root (Docker / git checkout).
 */

import { fileURLToPath } from 'url';
import { dirname, join, isAbsolute } from 'path';
import { homedir } from 'os';

// Detect project root based on runtime location:
// - tsx runs from src/app/paths.ts (2 levels up)
// - node runs from dist/src/app/paths.js (3 levels up)
// Match /dist/ and \dist\ (Windows path.sep is \); a /dist/-only check fails there.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const isCompiledDist = /(?:^|[\\/])dist[\\/]/.test(__dirname);
export const PROJECT_ROOT = isCompiledDist
    ? join(__dirname, '..', '..', '..')
    : join(__dirname, '..', '..');

let dataDirOverride: string | undefined;

/** Call before initConfig when --home is passed. Pass undefined to clear. */
export function setDataDir(dir: string | undefined): void {
    dataDirOverride = dir ? expandUserPath(dir) : undefined;
}

export function getDataDir(): string {
    if (dataDirOverride) {
        return dataDirOverride;
    }
    if (process.env.LUMO_HOME) {
        return expandUserPath(process.env.LUMO_HOME);
    }
    return PROJECT_ROOT;
}

function expandHome(path: string): string | null {
    if (path === '~') return homedir();
    if (path.startsWith('~/') || path.startsWith('~\\')) {
        return join(homedir(), path.slice(2));
    }
    return null;
}

function expandUserPath(path: string): string {
    return resolveAgainst(process.cwd(), path);
}

function resolveAgainst(base: string, path: string): string {
    const home = expandHome(path);
    if (home) return home;
    if (isAbsolute(path)) return path;
    return join(base, path);
}

/** Bundled files (defaults, Go binary). */
export function resolveProjectPath(path: string): string {
    return resolveAgainst(PROJECT_ROOT, path);
}

/** User data (config, vault, sessions, logs). */
export function resolveDataPath(path: string): string {
    return resolveAgainst(getDataDir(), path);
}
