/**
 * Auth API routes
 *
 * - GET  /auth            - Login page (no API key)
 * - POST /auth/login      - Password login (no API key)
 * - POST /auth/sign-in/start|status|cancel — Proton desktop sign-in (any device)
 * - POST /auth/logout     - Sign out (no API key; server stays up)
 * - POST /v1/auth/logout  - Revoke session, delete tokens, exit process
 * - POST /v1/auth/refresh - Manually trigger token refresh
 * - GET  /v1/auth/status  - Get current auth status
 */

import { existsSync } from 'fs';
import { Router, Request, Response } from 'express';
import { EndpointDependencies } from '../types.js';
import { getAutoSyncService } from '../../conversations/index.js';
import { logger } from '../../app/logger.js';
import { runLoginAuthentication } from '../../auth/login/authenticate.js';
import { ProtonAuthError } from '../../auth/login/proton-auth-cli.js';
import { SRP_ERROR_2FA_REQUIRED } from '../../auth/login/types.js';
import { updateAuthConfig } from '../../auth/update-config.js';
import { isCaptchaAuthError } from '../../auth/sync-capability.js';
import { deleteTokenCache } from '../../auth/logout.js';
import { DESKTOP_CDP_DEFAULT, DOCKER_CDP_DEFAULT, SIDECAR_NEEDED_ERROR } from '../../auth/sidecar.js';
import {
  beginDesktopLogin,
  checkDesktopLogin,
  cancelDesktopLogin,
  isDesktopLoginNeededError,
} from '../../auth/desktop-login.js';
import { sendAuthRequired } from '../error-handler.js';
import { htmlPage } from '../web-ui.js';
import { VERSION } from '../../app/version.js';
import { getConversationsConfig } from '../../app/config.js';
import { clientIp, createAttemptGate } from '../attempt-limit.js';
import { APP, AUTH, PORTS } from '../../app/const.js';

const allowLoginAttempt = createAttemptGate(AUTH.LOGIN_MAX_ATTEMPTS);

export interface AuthRouterHooks {
  onAuthenticated?: () => Promise<void>;
  onLoggedOut?: () => void | Promise<void>;
  getSessionNotice?: () => string | null;
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

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] ?? ch
  ));
}

function renderAuthPage(state: { loggedIn: boolean; sync?: boolean; method?: string; sessionNotice?: string }): string {
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
  ${state.sessionNotice ? `<p class="err" id="sessionNotice">${escapeHtml(state.sessionNotice)}</p>` : ''}
  <p class="lede">${state.sessionNotice ? 'Log in again to restore Lumo.' : 'Sign in with Proton. Open the link on this phone or any browser.'}</p>
  <button type="button" id="signInBtn" style="width:100%">Start Proton sign-in</button>
  <div id="signInPending" hidden style="margin-top:0.85rem">
    <p class="hint" id="signInHint">Finish sign-in on Proton, keep this page open.</p>
    <p class="btn-row" style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.5rem">
      <a class="btn" id="signInOpen" href="#" target="_blank" rel="noopener noreferrer" style="flex:1;text-align:center">Open Proton sign-in</a>
      <button type="button" class="secondary" id="signInCopy">Copy link</button>
    </p>
    <p class="hint" id="signInWait" style="margin-top:0.5rem">Waiting for you to finish…</p>
  </div>
  <p id="msg" class="err" hidden></p>
  <details class="fail" style="margin-top:1.1rem">
    <summary>Email and password instead</summary>
    <form id="f" method="post" action="/auth/login" autocomplete="on" style="margin-top:0.75rem">
      <label for="username">Proton email</label>
      <input id="username" name="username" type="email" autocomplete="username" required>
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <label for="one-time-code">Authenticator code</label>
      <input id="one-time-code" name="otp" type="text" inputmode="numeric" autocomplete="one-time-code"
        autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="8" pattern="[0-9]*" placeholder="123456">
      <button type="submit" style="width:100%;margin-top:1.1rem">Log in with password</button>
    </form>
    <p class="hint">Password is sent to this server only and is not stored. Proton may block this (CAPTCHA / 2028) — use sign-in above.</p>
  </details>
  <details class="fail" id="fail">
    <summary>If login fails</summary>
    <div class="fail-body">
      <h3>1. Proton sign-in</h3>
      <p>Use <strong>Start Proton sign-in</strong>. Open the Proton page on any device, finish login, wait here.</p>
      <h3>2. Password</h3>
      <p>${AUTH.LOGIN_MAX_ATTEMPTS} attempts per ${AUTH.ATTEMPT_WINDOW_MS / 60_000} minutes. CAPTCHA: open <code>lumo.proton.me</code> on the same internet, then retry. 2028: password is locked — use Proton sign-in.</p>
      <h3>3. Sidecar (last resort)</h3>
      <p>This container cannot open a window (and must not try to install Chrome). Start the sidecar, log in, extract tokens, then <strong>remove only the sidecar</strong>. Leave <code>${APP.CONTAINER_NAME}</code> (port ${PORTS.TAMER}) running.</p>
      <p>From the compose directory (often <code>/opt/${APP.NAME}</code>):</p>
      <ol>
        <li><code>docker compose --profile browser up -d browser</code></li>
        <li>Open <code>http://&lt;host&gt;:${PORTS.NOVNC}</code> and sign in at lumo.proton.me (CAPTCHA and security keys work)</li>
        <li><code>docker compose run --rm -it tamer auth browser</code><br>CDP default is <code>${DOCKER_CDP_DEFAULT}</code>. That writes <code>auth.method: browser</code>, <code>auth.browser.launch: false</code>, and the CDP URL — do not set <code>launch: true</code> or <code>${DESKTOP_CDP_DEFAULT}</code> inside Docker.</li>
        <li>Reload this page (the running server picks up the vault; do not restart tamer)</li>
        <li>Stop and remove <em>only</em> the sidecar:
          <br><code>docker compose --profile browser stop browser</code>
          <br><code>docker compose --profile browser rm -f browser</code></li>
        <li>Optional — drop the image and Chromium profile so the next start is clean:
          <br><code>docker rmi \$(docker images -q --filter reference='*lumo-tamer*browser*') 2&gt;/dev/null</code>
          <br><code>rm -rf ./browser-data</code></li>
        <li>Check it is gone: <code>docker ps -a --filter name=${APP.BROWSER_CONTAINER_NAME}</code> (empty = gone)</li>
      </ol>
      <p>Portainer: start/stop/remove the container named <code>${APP.BROWSER_CONTAINER_NAME}</code> only. Console on <code>${APP.CONTAINER_NAME}</code> can run <code>tamer auth browser</code>. Do not stop the stack or the <code>${APP.CONTAINER_NAME}</code> container.</p>
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
      btn.textContent = 'Signing in…';
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
        if (data.needDesktopLogin && data.url && data.id) {
          showDesktopLogin(data.url, data.id);
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
    const signInBtn = document.getElementById('signInBtn');
    const signInPending = document.getElementById('signInPending');
    const signInOpen = document.getElementById('signInOpen');
    const signInCopy = document.getElementById('signInCopy');
    let signInTimer;
    let signInId = '';
    let signInUrl = '';
    function showDesktopLogin(url, id) {
      signInId = id;
      signInUrl = url;
      signInOpen.setAttribute('href', url);
      signInPending.hidden = false;
      msg.hidden = true;
      if (fail) fail.open = false;
      if (signInTimer) clearInterval(signInTimer);
      signInTimer = setInterval(async () => {
        try {
          const res = await fetch('/auth/sign-in/status?id=' + encodeURIComponent(id));
          const data = await res.json();
          if (data.ready) location.reload();
          if (!res.ok && data.error) {
            msg.textContent = data.error;
            msg.hidden = false;
            clearInterval(signInTimer);
          }
        } catch (_) { /* keep polling */ }
      }, 2000);
    }
    signInCopy.addEventListener('click', async () => {
      if (!signInUrl) return;
      try {
        await navigator.clipboard.writeText(signInUrl);
        signInCopy.textContent = 'Copied';
        setTimeout(() => { signInCopy.textContent = 'Copy link'; }, 1500);
      } catch (_) {
        msg.textContent = 'Clipboard unavailable';
        msg.hidden = false;
      }
    });
    signInBtn.addEventListener('click', async () => {
      signInBtn.disabled = true;
      signInBtn.textContent = 'Starting…';
      try {
        const res = await fetch('/auth/sign-in/start', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not start Proton sign-in');
        showDesktopLogin(data.url, data.id);
      } catch (err) {
        msg.textContent = err.message || 'Could not start Proton sign-in';
        msg.hidden = false;
      } finally {
        signInBtn.disabled = false;
        signInBtn.textContent = 'Start Proton sign-in';
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

  router.get('/auth', async (_req: Request, res: Response) => {
    if (deps.authManager && !deps.authManager.getProvider().isValid()) {
      try {
        await deps.authManager.refreshNow();
      } catch (error) {
        logger.warn({ error }, 'Re-login required: token refresh failed on /auth');
      }
    }

    if (!deps.authManager && deps.vaultPath && existsSync(deps.vaultPath)) {
      try {
        await hooks.onAuthenticated?.();
      } catch (error) {
        logger.warn({ error }, 'Vault present but could not load it for /auth');
        try {
          await deleteTokenCache(deps.vaultPath);
        } catch { /* still show the login form */ }
      }
    }

    if (deps.authManager?.getProvider().isValid()) {
      const provider = deps.authManager.getProvider();
      res.type('html').send(renderAuthPage({
        loggedIn: true,
        sync: provider.supportsFullApi(),
        method: provider.method,
      }));
      return;
    }

    res.type('html').send(renderAuthPage({
      loggedIn: false,
      sessionNotice: hooks.getSessionNotice?.() ?? undefined,
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
      if (isDesktopLoginNeededError(error)) {
        try {
          const started = await beginDesktopLogin();
          res.status(401).json({
            needDesktopLogin: true,
            url: started.url,
            id: started.id,
            error: 'Proton blocked password login. Open Proton sign-in on any device.',
          });
          return;
        } catch (signInError) {
          logger.error({ signInError }, 'Could not start Proton sign-in');
          res.status(401).json({
            error: 'Proton blocked password login, and sign-in could not be started. See “If login fails”.',
          });
          return;
        }
      }
      const message = error instanceof Error ? error.message : 'Login failed';
      logger.error({ error }, "Can't log in via /auth");
      const sidecarHint = message === SIDECAR_NEEDED_ERROR;
      res.status(401).json({
        error: isCaptchaAuthError(error)
          ? 'Proton asked for a CAPTCHA. Open lumo.proton.me once from the same internet as this server, then try again.'
          : sidecarHint
            ? SIDECAR_NEEDED_ERROR
            : message.replace(/^Authentication failed: /i, ''),
      });
    }
  });

  router.post('/auth/sign-in/start', async (_req: Request, res: Response) => {
    try {
      const started = await beginDesktopLogin();
      res.json({ url: started.url, id: started.id });
    } catch (error) {
      logger.error({ error }, 'POST /auth/sign-in/start failed');
      res.status(502).json({
        error: error instanceof Error ? error.message : 'Could not start Proton sign-in',
      });
    }
  });

  router.get('/auth/sign-in/status', async (req: Request, res: Response) => {
    const id = typeof req.query.id === 'string' ? req.query.id : '';
    if (!id) {
      res.status(400).json({ error: 'Missing id' });
      return;
    }
    try {
      const result = await checkDesktopLogin(id);
      if (!result.ready) {
        res.json({ ready: false });
        return;
      }
      try {
        updateAuthConfig({ method: result.method });
      } catch (error) {
        logger.warn({ error }, 'Could not persist auth.method after Proton sign-in');
      }
      await hooks.onAuthenticated?.();
      res.json({ ready: true, sync: result.sync, method: result.method });
    } catch (error) {
      logger.error({ error }, 'GET /auth/sign-in/status failed');
      res.status(502).json({
        error: error instanceof Error ? error.message : 'Sign-in poll failed',
      });
    }
  });

  router.post('/auth/sign-in/cancel', (req: Request, res: Response) => {
    const id = typeof req.body?.id === 'string' ? req.body.id : undefined;
    cancelDesktopLogin(id);
    res.json({ ok: true });
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
      if (!deps.authManager) {
        sendAuthRequired(res);
        return;
      }
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
