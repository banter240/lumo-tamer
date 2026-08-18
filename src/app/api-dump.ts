import { appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { getLogConfig } from './config.js';
import { resolveDataPath } from './paths.js';
import { logger } from './logger.js';
import { redactValue } from './log-redact.js';

const MAX_BODY = 64 * 1024;

function clip(value: unknown): unknown {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    if (!text) return value;
    return text.length > MAX_BODY ? `${text.slice(0, MAX_BODY)}…` : value;
}

/** Append one redacted Proton API line when log.dumpApiPath is set (#19). */
export function dumpProtonApiCall(entry: {
    method: string;
    url: string;
    status: number;
    request?: unknown;
    response?: unknown;
    stream?: boolean;
}): void {
    let path: string;
    try {
        const configured = getLogConfig().dumpApiPath;
        if (!configured) return;
        path = resolveDataPath(configured);
    } catch {
        return;
    }

    try {
        mkdirSync(dirname(path), { recursive: true });
        appendFileSync(path, `${JSON.stringify({
            t: new Date().toISOString(),
            method: entry.method,
            url: redactValue(entry.url),
            status: entry.status,
            stream: entry.stream ?? false,
            request: clip(redactValue(entry.request)),
            response: entry.response === undefined ? undefined : clip(redactValue(entry.response)),
        })}\n`);
    } catch (error) {
        logger.warn({ error, path }, 'Failed to dump Proton API call');
    }
}
