/**
 * Strip login identity from log fields and strings.
 * Tool-call JSON (names, paths, commands) is left intact.
 */

const REDACTED = '[Redacted]';

const SECRET_KEYS = new Set([
  'password',
  'passwd',
  'secret',
  'token',
  'tokens',
  'accesstoken',
  'refreshtoken',
  'access_token',
  'refresh_token',
  'authorization',
  'cookie',
  'cookies',
  'set-cookie',
  'email',
  'username',
  'uid',
  'totp',
  'keypassword',
  'mailboxpassword',
  'clientkey',
  'userkeys',
  'masterkeys',
  'privatekey',
  'passphrase',
  'vaultkey',
  'apikey',
  'api_key',
  'credentials',
  'sessionblob',
]);

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const BEARER_RE = /\bBearer\s+\S+/gi;
const COOKIE_HEADER_RE = /\b(?:Cookie|Set-Cookie)\s*[:=]\s*[^\n\r]+/gi;
const UID_HEADER_RE = /\bx-pm-uid\s*[:=]\s*\S+/gi;

function isSecretKey(key: string): boolean {
  return SECRET_KEYS.has(key.toLowerCase().replace(/-/g, ''));
}

export function redactString(value: string): string {
  return value
    .replace(EMAIL_RE, REDACTED)
    .replace(BEARER_RE, 'Bearer [Redacted]')
    .replace(COOKIE_HEADER_RE, '[Redacted cookie]')
    .replace(UID_HEADER_RE, 'x-pm-uid=[Redacted]');
}

export function redactValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return redactString(value);
  if (value == null || typeof value !== 'object') return value;

  if (seen.has(value)) return REDACTED;
  seen.add(value);

  if (value instanceof Error) {
    const out: Record<string, unknown> = {
      name: value.name,
      message: redactString(value.message),
    };
    if (value.stack) out.stack = redactString(value.stack);
    // ProtonApiError attaches status/Code/data/body as enumerable own props.
    for (const [key, nested] of Object.entries(value)) {
      if (key === 'name' || key === 'message' || key === 'stack') continue;
      out[key] = isSecretKey(key) ? REDACTED : redactValue(nested, seen);
    }
    return out;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, seen));
  }

  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSecretKey(key) ? REDACTED : redactValue(nested, seen);
  }
  return out;
}

export function redactLogArgs(args: unknown[]): unknown[] {
  return args.map((arg) => redactValue(arg));
}
