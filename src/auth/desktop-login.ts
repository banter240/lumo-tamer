import { createDecipheriv, randomBytes } from 'crypto';
import { APP_VERSION_HEADER } from '@lumo/config.js';
import { logger } from '../app/logger.js';
import { AUTH } from '../app/const.js';
import { writeVault, configuredVault } from './vault/index.js';
import { createProtonApi } from './api-factory.js';
import { fetchKeys } from './fetch-keys.js';
import { hasProtonSyncKeys } from './sync-capability.js';
import type { StoredTokens } from './types.js';

const CLIENT_ID = 'web-lumo';
const TTL_MS = 10 * 60 * 1000;

const ENDPOINTS = [
  { api: 'https://mail.proton.me/api', app: 'proton-lumo' },
  { api: 'https://lumo.proton.me/api', app: 'lumo' },
] as const;

type Endpoint = (typeof ENDPOINTS)[number];

type Pending = {
  id: string;
  key: Buffer;
  endpoint: Endpoint;
  startedAt: number;
};

const pending = new Map<string, Pending>();

export type DesktopLoginStart = {
  id: string;
  url: string;
};

async function protonGet(api: string, path: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${api}${path}`, {
    headers: {
      Accept: 'application/json',
      'x-pm-appversion': APP_VERSION_HEADER,
    },
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Proton returned non-JSON (${res.status})`);
  }
  return { status: res.status, json };
}

export function desktopLoginUrl(userCode: string, key: Buffer, app: string): string {
  const fragment = `0:${userCode}:${key.toString('base64')}:${CLIENT_ID}`;
  const u = new URL('https://account.proton.me/desktop/login');
  u.searchParams.set('app', app);
  u.searchParams.set('pv', '3');
  u.hash = `payload=${encodeURIComponent(fragment)}`;
  return u.toString();
}

export function mailboxPasswordFromProtonBlob(key: Buffer, b64: string): string {
  const raw = Buffer.from(b64, 'base64');
  if (raw.length < 28) throw new Error('Proton login blob too short');
  const nonce = raw.subarray(0, 12);
  const tag = raw.subarray(raw.length - 16);
  const data = raw.subarray(12, raw.length - 16);
  const dec = createDecipheriv('aes-256-gcm', key, nonce);
  dec.setAAD(Buffer.from('fork'));
  dec.setAuthTag(tag);
  const json = JSON.parse(Buffer.concat([dec.update(data), dec.final()]).toString('utf8')) as { keyPassword?: string };
  if (!json.keyPassword) throw new Error('Proton login blob has no mailbox password');
  return json.keyPassword;
}

function dropExpired(): void {
  const now = Date.now();
  for (const [id, item] of pending) {
    if (now - item.startedAt > TTL_MS) pending.delete(id);
  }
}

export async function beginDesktopLogin(): Promise<DesktopLoginStart> {
  dropExpired();
  let last: unknown;
  for (const endpoint of ENDPOINTS) {
    try {
      const { status, json } = await protonGet(endpoint.api, '/auth/v4/sessions/forks');
      const selector = typeof json.Selector === 'string' ? json.Selector : '';
      const userCode = typeof json.UserCode === 'string' ? json.UserCode : '';
      if (status < 200 || status > 299 || !selector || !userCode) {
        last = new Error(`Proton login init ${status}`);
        continue;
      }
      const key = randomBytes(32);
      pending.set(selector, { id: selector, key, endpoint, startedAt: Date.now() });
      logger.info({ app: endpoint.app }, 'Proton desktop login started');
      return { id: selector, url: desktopLoginUrl(userCode, key, endpoint.app) };
    } catch (error) {
      last = error;
    }
  }
  throw last instanceof Error ? last : new Error('Could not start Proton sign-in');
}

export async function checkDesktopLogin(id: string): Promise<
  | { ready: false }
  | { ready: true; sync: boolean; method: 'login' }
> {
  dropExpired();
  const item = pending.get(id);
  if (!item) return { ready: false };

  const { status, json } = await protonGet(
    item.endpoint.api,
    `/auth/v4/sessions/forks/${encodeURIComponent(id)}`,
  );
  if (status === 422) return { ready: false };
  const uid = typeof json.UID === 'string' ? json.UID : '';
  const accessToken = typeof json.AccessToken === 'string' ? json.AccessToken : '';
  const refreshToken = typeof json.RefreshToken === 'string' ? json.RefreshToken : '';
  const blob = typeof json.Payload === 'string' ? json.Payload : '';
  if (status < 200 || status > 299 || !uid || !accessToken || !refreshToken || !blob) {
    throw new Error(`Proton sign-in not complete (${status})`);
  }

  const keyPassword = mailboxPasswordFromProtonBlob(item.key, blob);
  pending.delete(id);

  const fetched = await fetchKeys(createProtonApi({ uid, accessToken }));
  const tokens: StoredTokens = {
    method: 'login',
    uid,
    accessToken,
    refreshToken,
    keyPassword,
    expiresAt: new Date(Date.now() + AUTH.DEFAULT_ACCESS_TOKEN_TTL_SEC * 1000).toISOString(),
    extractedAt: new Date().toISOString(),
    userKeys: fetched.userKeys,
    masterKeys: fetched.masterKeys,
  };
  if (!hasProtonSyncKeys(tokens) && tokens.keyPassword) {
    const { generateLocalKeys } = await import('./key-generator.js');
    const generated = await generateLocalKeys(tokens.keyPassword);
    tokens.userKeys = generated.userKeys;
    tokens.masterKeys = generated.masterKeys;
  }

  const { vaultPath, keyConfig } = configuredVault();
  await writeVault(vaultPath, tokens, keyConfig);
  logger.info({ vaultPath, sync: hasProtonSyncKeys(tokens) }, 'Proton desktop login saved');
  return { ready: true, sync: hasProtonSyncKeys(tokens), method: 'login' };
}

export function cancelDesktopLogin(id?: string): void {
  if (id) pending.delete(id);
  else pending.clear();
}

export class DesktopLoginNeededError extends Error {
  readonly code = 'DESKTOP_LOGIN_NEEDED';
  constructor() {
    super('Proton blocked password login. Use Proton sign-in.');
    this.name = 'DesktopLoginNeededError';
  }
}

export function isDesktopLoginNeededError(error: unknown): boolean {
  return error instanceof DesktopLoginNeededError;
}
