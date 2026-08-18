import type { Request } from 'express';

export function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

/** Sliding window: first hit opens a window; further hits count until max. */
export function createAttemptGate(
  maxAttempts: number,
  windowMs = 10 * 60 * 1000,
): (ip: string) => boolean {
  const attempts = new Map<string, { count: number; resetAt: number }>();
  return (ip: string): boolean => {
    const now = Date.now();
    const cur = attempts.get(ip);
    if (!cur || now > cur.resetAt) {
      attempts.set(ip, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (cur.count >= maxAttempts) return false;
    cur.count += 1;
    return true;
  };
}
