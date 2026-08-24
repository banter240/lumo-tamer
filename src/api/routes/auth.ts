/**
 * Auth API routes
 *
 * - GET  /auth            - Login page (no API key)
 * - POST /auth/login      - Password login (no API key)
 * - POST /auth/logout     - Sign out (no API key; server stays up)
 * - POST /v1/auth/logout  - Revoke session, delete tokens, exit process
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
import { isCaptchaAuthError } from '../../auth/sync-capability.js';
import { htmlPage } from '../web-ui.js';
import { VERSION } from '../../app/version.js';
import { getConversationsConfig } from '../../app/config.js';
import { clientIp, createAttemptGate } from '../attempt-limit.js';

const allowLoginAttempt = createAttemptGate(5);

export interface AuthRouterHooks {
  onAuthenticated?: () => Promise<void>;
  onLoggedOut?: () => void | Promise<void>;
}

function loginStatus(syncCapable: boolean, method?: string): {
  how: string;
  sync: 'on' | 'off' | 'unavailable';
  note: string;
  message: string;
  detail: string;
} {
  const how = method === 'browser' ? 'Browser' : method === 'rclone' ? 'rclone' : 'Password';
  const message = `Signed in via ${how.toLowerCase()}. This server can reach Lumo.`;
  const enabled = getConversationsConfig().enableSync;
  if (!syncCapable) {
    const note = method === 'browser'
      ? 'Cookies were not from lumo.proton.me, so this session has no Lumo-scoped keys.'
      : 'Password login only got Drive scope.';
    return {
      how, sync: 'unavailable', note, message,
      detail: `Conversation sync is not available. ${note}`,
    };
  }
  if (enabled) {
    return {
      how, sync: 'on', note: 'Threads can show up on lumo.proton.me.', message,
      detail: 'Conversation sync is on in Settings. Threads can show up on lumo.proton.me.',
    };
  }
  return {
    how, sync: 'off',
    note: 'Turn on “Sync chats to Proton” in Settings if you want threads there.',
    message,
    detail: 'This session can sync. Sync chats to Proton is off in Settings.',
  };
}

function signedInCard(syncCapable: boolean, method?: string): string {
  const st = loginStatus(syncCapable, method);
  const syncPill = st.sync === 'on'
    ? '<span class="pill pill-ok">On</span>'
    : st.sync === 'off'
      ? '<span class="pill pill-off">Off</span>'
      : '<span class="pill pill-no">Unavailable</span>';
  return `<div class="card">
    <p class="signed-kicker">Signed in</p>
    <h2 class="signed-title">${st.how}</h2>
    <div class="stats">
      <div class="stat">
        <div class="stat-top"><span>Lumo API</span><span class="pill pill-ok">Ready</span></div>
        <p class="stat-note">Clients can call this server (Home Assistant, OpenCode, …).</p>
      </div>
      <div class="stat">
        <div class="stat-top"><span>lumo.proton.me</span>${syncPill}</div>
        <p class="stat-note">${st.note}</p>
      </div>
    </div>
    <a class="btn" href="/config" style="width:100%">Settings</a>
    <button type="button" class="secondary" id="logout" style="width:100%;margin-top:0.5rem">Log out</button>
    <script>
      const logoutBtn = document.getElementById('logout');
      if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
          logoutBtn.disabled = true;
          logoutBtn.textContent = 'Signing out…';
          try {
            await fetch('/auth/logout', { method: 'POST' });
          } catch (_) { /* still send them to the form */ }
          location.href = '/auth';
        });
      }
    </script>
  </div>`;
}

function renderAuthPage(state: { loggedIn: boolean; sync?: boolean; method?: string }): string {
  const extraCss = `
    .fail { margin: 1.15rem 0 0; border-top: 1px solid var(--line); padding-top: 0.95rem; }
    .fail > summary {
      cursor: pointer; list-style: none; color: var(--purple);
      font-size: 0.82rem; font-weight: 600;
    }
    .fail > summary::-webkit-details-marker { display: none; }
    .fail > summary::after { content: ' ▾'; font-weight: 500; }
    .fail[open] > summary::after { content: ' ▴'; }
    .fail-body { margin: 0.75rem 0 0; color: var(--muted); font-size: 0.84rem; }
    .fail-body h3 { margin: 0.9rem 0 0.3rem; font-size: 0.82rem; color: var(--text); font-weight: 650; }
    .fail-body h3:first-child { margin-top: 0; }
    .fail-body p { margin: 0 0 0.45rem; line-height: 1.5; }
    .fail-body ol { margin: 0.25rem 0 0.5rem; padding-left: 1.2rem; }
    .fail-body li { margin: 0.35rem 0; line-height: 1.5; }
    .fail-body code {
      display: inline-block; margin: 0.12rem 0; font-size: 0.78em;
      word-break: break-all;
    }
    .signed-kicker { margin: 0; font-size: 0.75rem; font-weight: 650; letter-spacing: 0.04em; text-transform: uppercase; color: var(--ok); }
    .signed-title { margin: 0.15rem 0 0; font-size: 1.25rem; letter-spacing: -0.03em; }
    .stats { margin: 1.05rem 0 1.15rem; }
    .stat { padding: 0.75rem 0; border-top: 1px solid var(--line); }
    .stat-top { display: flex; justify-content: space-between; align-items: center; gap: 0.75rem; font-size: 0.88rem; font-weight: 600; }
    .stat-note { margin: 0.28rem 0 0; font-size: 0.8rem; color: var(--muted); line-height: 1.45; }
    .pill { font-size: 0.68rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; padding: 0.18rem 0.5rem; border-radius: 999px; }
    .pill-ok { background: var(--ok-soft); color: var(--ok); }
    .pill-off { background: var(--purple-soft); color: var(--purple); }
    .pill-no { background: var(--line); color: var(--muted); }
  `;
  const inner = state.loggedIn
    ? signedInCard(!!state.sync, state.method)
    : `<div class="card">
  <p class="lede">Log in with your Proton account. No extra browser container.</p>
  <form id="f" method="post" action="/auth/login" autocomplete="on">
    <label for="username">Proton email</label>
    <input id="username" name="username" type="email" autocomplete="username" required>
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required>
    <label for="one-time-code">Authenticator code</label>
    <input id="one-time-code" name="otp" type="text" inputmode="numeric" autocomplete="one-time-code"
      autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="8" pattern="[0-9]*" placeholder="123456">
    <button type="submit" style="width:100%;margin-top:1.1rem">Log in</button>
  </form>
  <p id="msg" class="err" hidden></p>
  <p class="hint">Password is sent to this server only and is not stored. Stay on this tab until it says signed in.</p>
  <details class="fail" id="fail">
    <summary>If login fails</summary>
    <div class="fail-body">
      <h3>1. Password or authenticator</h3>
      <p>Try again. Five attempts per ten minutes.</p>
      <h3>2. CAPTCHA</h3>
      <p>Open <code>lumo.proton.me</code> in any browser on the <strong>same internet</strong> as this server, then retry this form.</p>
      <h3>3. Desktop — Proton 2028 / “unusual activity”</h3>
      <p>A Chrome window should open. Log in there. This tab updates when tokens are saved. Submitting this form again will not help.</p>
      <h3>4. Docker, no monitor — 2028</h3>
      <p>This container cannot open a window. Start the sidecar, log in, extract tokens, then stop it (~1 GB):</p>
      <ol>
        <li><code>docker compose --profile browser up -d browser</code></li>
        <li>Open <code>http://&lt;host&gt;:3001</code> and sign in at lumo.proton.me</li>
        <li><code>docker compose run --rm tamer auth browser</code><br>If asked for CDP: <code>http://browser:9222</code></li>
        <li><code>docker compose --profile browser stop browser</code></li>
        <li>Reload this page</li>
      </ol>
    </div>
  </details>
  </div>
  <script>
    const form = document.getElementById('f');
    const msg = document.getElementById('msg');
    const fail = document.getElementById('fail');
    const otp = document.getElementById('one-time-code');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      msg.hidden = true;
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      btn.textContent = 'Waiting (a browser window may open)...';
      try {
        const body = {
          username: form.username.value,
          password: form.password.value,
          totp: otp.value,
        };
        const res = await fetch('/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (data.needTotp) {
          msg.textContent = 'Enter your authenticator code and try again.';
          msg.hidden = false;
          otp.focus();
          return;
        }
        if (!res.ok) {
          msg.textContent = data.error || 'Login failed';
          msg.hidden = false;
          if (fail) fail.open = true;
          return;
        }
        location.reload();
      } catch (err) {
        msg.textContent = 'Network error';
        msg.hidden = false;
        if (fail) fail.open = true;
      } finally {
        btn.disabled = false;
        btn.textContent = 'Log in';
      }
    });
  </script>`;
  return htmlPage({
    title: 'Sign in · lumo-tamer',
    body: inner,
    extraCss,
    page: 'auth',
    version: VERSION,
  });
}

export function createAuthRouter(deps: EndpointDependencies, hooks: AuthRouterHooks = {}): Router {
  const router = Router();

  router.get('/auth', (_req: Request, res: Response) => {
    if (!deps.authManager) {
      res.type('html').send(renderAuthPage({ loggedIn: false }));
      return;
    }
    const provider = deps.authManager.getProvider();
    res.type('html').send(renderAuthPage({
      loggedIn: true,
      sync: provider.supportsFullApi(),
      method: provider.method,
    }));
  });

  router.post('/auth/logout', async (_req: Request, res: Response) => {
    if (!deps.authManager) {
      res.json({ success: true, message: 'Already signed out.' });
      return;
    }
    try {
      getAutoSyncService()?.stop();
      await deps.authManager.logout();
      await hooks.onLoggedOut?.();
      logger.info('Logout via /auth');
      res.json({ success: true, message: 'Signed out. You can log in with another account.' });
    } catch (error) {
      logger.error({ error }, "Can't log out via /auth");
      try {
        await hooks.onLoggedOut?.();
      } catch (_) { /* still return error */ }
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Logout failed',
      });
    }
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
      try {
        updateAuthConfig({ method: login.method });
      } catch (error) {
        logger.warn({ error }, 'Could not persist auth.method after login');
      }
      await hooks.onAuthenticated?.();
      logger.info({ sync: login.sync, method: login.method }, 'Login via /auth successful');
      const copy = loginStatus(login.sync, login.method);
      res.json({
        success: true,
        sync: login.sync,
        method: login.method,
        message: copy.message,
        detail: copy.detail,
      });
    } catch (error) {
      if (error instanceof ProtonAuthError && error.errorCode === SRP_ERROR_2FA_REQUIRED) {
        res.status(401).json({ needTotp: true, error: '2FA code required' });
        return;
      }
      const message = error instanceof Error ? error.message : 'Login failed';
      logger.error({ error }, "Can't log in via /auth");
      res.status(401).json({
        error: isCaptchaAuthError(error)
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
