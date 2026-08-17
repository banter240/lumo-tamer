/**
 * Auth API routes
 *
 * - GET  /auth            - Login page (no API key)
 * - POST /auth/login      - Password login (no API key)
 * - POST /v1/auth/logout  - Revoke session and delete tokens
 * - POST /v1/auth/refresh - Manually trigger token refresh
 * - GET  /v1/auth/status  - Get current auth status
 */

import { Router, Request, Response } from 'express';
import { EndpointDependencies } from '../types.js';
import { getAutoSyncService } from '../../conversations/index.js';
import { logger } from '../../app/logger.js';
import { runLoginAuthentication } from '../../auth/login/authenticate.js';
import { ProtonAuthError } from '../../auth/login/proton-auth-cli.js';
import { SRP_ERROR_2FA_REQUIRED } from '../../auth/login/types.js';
import { updateAuthConfig } from '../../auth/update-config.js';

const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

export interface AuthRouterHooks {
  onAuthenticated?: () => Promise<void>;
}

function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function allowLoginAttempt(ip: string): boolean {
  const now = Date.now();
  const cur = loginAttempts.get(ip);
  if (!cur || now > cur.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return true;
  }
  if (cur.count >= LOGIN_MAX_ATTEMPTS) {
    return false;
  }
  cur.count += 1;
  return true;
}

function renderAuthPage(loggedIn: boolean): string {
  const status = loggedIn
    ? '<p class="ok">Logged in. API is ready. You can close this tab.</p>'
    : '<p>Log in with your Proton account. No extra browser container.</p>';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>lumo-tamer login</title>
  <style>
    :root { color-scheme: dark; }
    body { font-family: system-ui, sans-serif; max-width: 28rem; margin: 3rem auto; padding: 0 1rem; background: #111; color: #eee; }
    h1 { font-size: 1.25rem; }
    label { display: block; margin: 0.75rem 0 0.25rem; font-size: 0.9rem; }
    input { width: 100%; box-sizing: border-box; padding: 0.5rem; border-radius: 6px; border: 1px solid #444; background: #1c1c1c; color: inherit; }
    button { margin-top: 1rem; padding: 0.6rem 1rem; border: 0; border-radius: 6px; background: #6c5ce7; color: #fff; font-weight: 600; cursor: pointer; }
    button:disabled { opacity: 0.6; cursor: wait; }
    .ok { color: #7bed9f; }
    .err { color: #ff7675; }
    .hint { color: #aaa; font-size: 0.85rem; line-height: 1.4; }
  </style>
</head>
<body>
  <h1>lumo-tamer</h1>
  ${status}
  <form id="f" method="post" action="/auth/login">
    <label for="username">Proton email</label>
    <input id="username" name="username" type="email" autocomplete="username" required>
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required>
    <label for="totp">2FA code (if you use one)</label>
    <input id="totp" name="totp" inputmode="numeric" autocomplete="one-time-code">
    <button type="submit">Log in</button>
  </form>
  <p id="msg" class="err" hidden></p>
  <p class="hint">Password is sent to this server only and is not stored.
  If Proton asks for a CAPTCHA, open <a href="https://lumo.proton.me" target="_blank" rel="noopener">lumo.proton.me</a> once from the same internet connection, then try again here.</p>
  <script>
    const form = document.getElementById('f');
    const msg = document.getElementById('msg');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      msg.hidden = true;
      const btn = form.querySelector('button');
      btn.disabled = true;
      try {
        const body = {
          username: form.username.value,
          password: form.password.value,
          totp: form.totp.value,
        };
        const res = await fetch('/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (data.needTotp) {
          msg.textContent = 'Enter your 2FA code and try again.';
          msg.hidden = false;
          form.totp.focus();
          return;
        }
        if (!res.ok) {
          msg.textContent = data.error || 'Login failed';
          msg.hidden = false;
          return;
        }
        const ok = data.sync
          ? 'Logged in. Conversation sync is on. You can close this tab.'
          : 'Logged in. Chat works. Sync is off for this session (CAPTCHA fallback).';
        document.querySelector('h1').insertAdjacentHTML('afterend', '<p class="ok">' + ok + '</p>');
        form.remove();
      } catch (err) {
        msg.textContent = 'Network error';
        msg.hidden = false;
      } finally {
        btn.disabled = false;
      }
    });
  </script>
</body>
</html>`;
}

export function createAuthRouter(deps: EndpointDependencies, hooks: AuthRouterHooks = {}): Router {
  const router = Router();

  router.get('/auth', (_req: Request, res: Response) => {
    res.type('html').send(renderAuthPage(!!deps.authManager));
  });

  router.post('/auth/login', async (req: Request, res: Response) => {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const totp = typeof req.body?.totp === 'string' ? req.body.totp.trim() : '';

    if (!username || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const ip = clientIp(req);
    if (!allowLoginAttempt(ip)) {
      res.status(429).json({ error: 'Too many login attempts. Wait a few minutes.' });
      return;
    }

    try {
      const login = await runLoginAuthentication({
        username,
        password,
        totp: totp || undefined,
      });
      updateAuthConfig({ method: 'login' });
      await hooks.onAuthenticated?.();
      logger.info({ sync: login.sync }, 'Login via /auth successful');
      res.json({
        success: true,
        sync: login.sync,
        message: login.sync
          ? 'Logged in. Conversation sync is on.'
          : 'Logged in. Chat works; Proton did not grant Lumo sync on this session.',
      });
    } catch (error) {
      if (error instanceof ProtonAuthError && error.errorCode === SRP_ERROR_2FA_REQUIRED) {
        res.status(401).json({ needTotp: true, error: '2FA code required' });
        return;
      }
      const message = error instanceof Error ? error.message : 'Login failed';
      logger.error({ error }, "Can't log in via /auth");
      const captcha = /captcha|human.?verif/i.test(message);
      res.status(401).json({
        error: captcha
          ? 'Proton asked for a CAPTCHA. Open lumo.proton.me once from the same internet as this server, then try again.'
          : message.replace(/^Authentication failed: /i, ''),
      });
    }
  });

  /**
   * POST /v1/auth/logout
   *
   * Revokes the current session on Proton's servers and deletes the local token cache.
   *
   * Response:
   * - 200: Logout successful
   * - 500: Logout failed
   */
  router.post('/v1/auth/logout', async (req: Request, res: Response) => {
    try {
      if (!deps.authManager || !deps.vaultPath) {
        res.status(500).json({
          error: {
            message: 'Auth manager not available',
            type: 'server_error',
          },
        });
        return;
      }

      // Stop auto-sync if running
      const autoSync = getAutoSyncService();
      autoSync?.stop();

      // Perform logout (stops refresh timer, revokes session, deletes tokens)
      await deps.authManager.logout();

      logger.info('Logout via API successful');

      // Schedule graceful shutdown after response is fully sent
      res.on('finish', () => {
        logger.info('Shutting down after logout...');
        process.exit(0);
      });

      res.json({
        success: true,
        message: 'Logged out successfully. Session revoked and tokens deleted. Server shutting down...',
      });
    } catch (error) {
      logger.error({ error }, 'Logout API failed');
      res.status(500).json({
        error: {
          message: error instanceof Error ? error.message : 'Logout failed',
          type: 'server_error',
        },
      });
    }
  });

  /**
   * POST /v1/auth/refresh
   *
   * Manually triggers a token refresh.
   *
   * Response:
   * - 200: Refresh successful
   * - 500: Refresh failed
   */
  router.post('/v1/auth/refresh', async (req: Request, res: Response) => {
    try {
      if (!deps.authManager) {
        res.status(500).json({
          error: {
            message: 'Auth manager not available',
            type: 'server_error',
          },
        });
        return;
      }

      await deps.authManager.refreshNow();

      logger.info('Token refresh via API successful');

      res.json({
        success: true,
        message: 'Tokens refreshed successfully.',
      });
    } catch (error) {
      logger.error({ error }, 'Token refresh API failed');
      res.status(500).json({
        error: {
          message: error instanceof Error ? error.message : 'Refresh failed',
          type: 'server_error',
        },
      });
    }
  });

  /**
   * GET /v1/auth/status
   *
   * Returns current authentication status.
   *
   * Response:
   * - 200: Status object
   */
  router.get('/v1/auth/status', (req: Request, res: Response) => {
    if (!deps.authManager) {
      res.status(500).json({
        error: {
          message: 'Auth manager not available',
          type: 'server_error',
        },
      });
      return;
    }

    const provider = deps.authManager.getProvider();
    const status = provider.getStatus();

    res.json({
      method: status.method,
      valid: status.valid,
      source: status.source,
      details: status.details,
      warnings: status.warnings,
    });
  });

  return router;
}
