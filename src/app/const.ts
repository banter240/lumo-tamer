/**
 * App-owned tunables (same idea as a HACS `const.py`).
 *
 * Change numbers here, not in call sites.
 * Not in this file:
 *   - Proton URLs → urls.ts
 *   - YAML / Settings defaults → config.defaults.yaml
 *     (runtime listen port, refresh interval, docker.sock path, …)
 *   - Proton protocol codes (2028, SRP 1002, …)
 *   - CSS
 *   - upstream packages/lumo
 *   - docker-compose.yml published ports (cannot import TS)
 */

export const APP = {
  NAME: 'lumo-tamer',
  CONTAINER_NAME: 'lumo-tamer',
  BROWSER_CONTAINER_NAME: 'lumo-tamer-browser',
  GITHUB_REPO: 'banter240/lumo-tamer',
  GHCR_REGISTRY: 'ghcr.io',
} as const;

export const APP_GITHUB_URL = `https://github.com/${APP.GITHUB_REPO}`;

/** Compose-published ports. YAML `server.port` is the runtime listen port. */
export const PORTS = {
  TAMER: 3003,
  NOVNC: 3001,
  CDP: 9222,
} as const;

export const CDP = {
  DESKTOP: `http://localhost:${PORTS.CDP}`,
  DOCKER: `http://browser:${PORTS.CDP}`,
} as const;

/** Prompt-token estimate (Proton does not report prompt_tokens). */
export const TOKEN_ESTIMATE = {
  /** Naive ASCII-ish guess. */
  NAIVE_BYTES_PER_TOKEN: 4,
  /** Auto vs naive. Factor 1.0 in Settings means this. 0.9 = 90% of auto. */
  AUTO_CALIBRATION: 1.45,
} as const;

export const AUTH = {
  LOGIN_MAX_ATTEMPTS: 5,
  CONFIG_SAVE_MAX_ATTEMPTS: 20,
  UPDATE_APPLY_MAX_ATTEMPTS: 3,
  /** Sliding window for the gates above. */
  ATTEMPT_WINDOW_MS: 10 * 60 * 1000,
  BROWSER_LOGIN_TIMEOUT_MS: 180_000,
  /** How often the headed login loop checks cookies. */
  BROWSER_LOGIN_POLL_MS: 400,
  /** Pause after Playwright navigates to another Proton origin. */
  BROWSER_NAV_PAUSE_MS: 500,
  MAX_REFRESH_FAILURES: 3,
  /** Fallback when Proton omits ExpiresIn (SRP / rclone / JSON refresh). */
  DEFAULT_ACCESS_TOKEN_TTL_SEC: 12 * 60 * 60,
  /** Browser cookie session is longer than the SRP access token. */
  BROWSER_SESSION_TTL_SEC: 24 * 60 * 60,
  /** Code fallback when AuthManager is constructed without YAML. */
  REFRESH_INTERVAL_HOURS_MIN: 1,
  REFRESH_INTERVAL_HOURS_MAX: 24,
  DEFAULT_REFRESH_INTERVAL_HOURS: 20,
} as const;

export const DOCKER_UPDATE = {
  API_PREFIX: '/v1.41',
  HELPER_NAME: 'lumo-tamer-updater',
  REQUEST_TIMEOUT_MS: 120_000,
  STOP_TIMEOUT_SEC: 15,
  STABLE_TAG: 'latest',
  DEV_TAG: 'dev',
} as const;

export const GITHUB = {
  RELEASES_PER_PAGE: 20,
  ACCEPT: 'application/vnd.github+json',
  API_VERSION: '2022-11-28',
  STABLE_BRANCH: 'main',
  DEV_BRANCH: 'dev',
} as const;

export const UPDATES = {
  CHECK_INTERVAL_HOURS_MIN: 1,
  CHECK_INTERVAL_HOURS_MAX: 168,
} as const;

/** Conversation dirty-sync cadence (not YAML-configurable). */
export const AUTO_SYNC = {
  DEBOUNCE_MS: 5_000,
  MIN_INTERVAL_MS: 30_000,
  MAX_DELAY_MS: 60_000,
} as const;
