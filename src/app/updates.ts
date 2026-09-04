/**
 * GitHub release check + Docker self-update via the engine socket.
 *
 * Checking needs no extra privileges. Applying bind-mounts docker.sock on
 * *this* container (no standing updater). Switching stable ↔ dev still
 * requires LUMO_TAMER_IMAGE in .env to match.
 */

import { APP, DOCKER_UPDATE, GITHUB } from './const.js';
import { VERSION } from './version.js';
import { getUpdatesConfig, type UpdatesConfig } from './config.js';
import { logger } from './logger.js';
import {
  dockerSocketAvailable,
  pullAndSpawnHelper,
  recreateContainer,
  selfContainerName,
} from './docker-update.js';

export type UpdateChannel = 'stable' | 'dev';
export type UpdateAction = 'none' | 'update' | 'switch' | 'downgrade';

export interface GithubRelease {
  tag_name: string;
  prerelease: boolean;
  html_url: string;
  published_at: string;
}

export interface UpdateStatus {
  enabled: boolean;
  current: string;
  latest: string | null;
  latestUrl: string | null;
  available: boolean;
  /** What the chip should do for the *selected* channel, not “newest overall”. */
  action: UpdateAction;
  channel: UpdateChannel;
  runningChannel: UpdateChannel;
  repository: string;
  imageTag: string;
  channelTag: string;
  canApply: boolean;
  applyHint: string | null;
  checkedAt: string | null;
  error: string | null;
}

export function channelFromVersion(version: string): UpdateChannel {
  return parseVersion(version).pre.length > 0 ? 'dev' : 'stable';
}

export function githubBranchForChannel(channel: UpdateChannel): typeof GITHUB.STABLE_BRANCH | typeof GITHUB.DEV_BRANCH {
  return channel === 'stable' ? GITHUB.STABLE_BRANCH : GITHUB.DEV_BRANCH;
}

let cached: UpdateStatus | null = null;
let checker: NodeJS.Timeout | undefined;
let applying = false;

export function parseRepository(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '').replace(/\.git$/i, '');
  const fromUrl = trimmed.match(/github\.com[:/]+([^/]+\/[^/]+)/i);
  const repo = (fromUrl ? fromUrl[1] : trimmed).replace(/\.git$/i, '');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error('updates.repository must be owner/repo or a github.com URL');
  }
  return repo;
}

export function channelImageTag(channel: UpdateChannel): typeof DOCKER_UPDATE.STABLE_TAG | typeof DOCKER_UPDATE.DEV_TAG {
  return channel === 'stable' ? DOCKER_UPDATE.STABLE_TAG : DOCKER_UPDATE.DEV_TAG;
}

export function channelFromImageTag(tag: string): UpdateChannel {
  return tag === DOCKER_UPDATE.DEV_TAG ? 'dev' : 'stable';
}

export function targetImageRef(repository: string, channel: UpdateChannel): string {
  return `${APP.GHCR_REGISTRY}/${parseRepository(repository)}:${channelImageTag(channel)}`;
}

/**
 * Stable = latest non-prerelease (main). Dev = newest prerelease, else latest release.
 * Never mix tracks: picking stable must not return a -dev tag.
 */
export function pickRelease(
  releases: GithubRelease[],
  channel: UpdateChannel,
): GithubRelease | null {
  const list = channel === 'stable'
    ? releases.filter((r) => !r.prerelease && !/-dev\./i.test(r.tag_name))
    : releases.filter((r) => r.prerelease || /-dev\./i.test(r.tag_name));
  const pool = list.length > 0 ? list : (channel === 'dev' ? [...releases] : []);
  pool.sort((a, b) => {
    const byVer = compareVersions(b.tag_name, a.tag_name);
    if (byVer !== 0) return byVer;
    return Date.parse(b.published_at) - Date.parse(a.published_at);
  });
  return pool[0] ?? null;
}

export function classifyTrack(opts: {
  current: string;
  imageTag: string;
  channel: UpdateChannel;
  latestOnChannel: string | null;
}): { action: UpdateAction; runningChannel: UpdateChannel } {
  const runningChannel = channelFromVersion(opts.current);
  if (!opts.latestOnChannel) return { action: 'none', runningChannel };
  const cmp = compareVersions(opts.latestOnChannel, opts.current);
  // Same version on this track: not a switch, even if compose still pins the other tag.
  if (cmp === 0) return { action: 'none', runningChannel };
  if (runningChannel !== opts.channel) {
    return { action: cmp < 0 ? 'downgrade' : 'switch', runningChannel };
  }
  if (cmp > 0) return { action: 'update', runningChannel };
  return { action: 'none', runningChannel };
}

export function imageTagFromRef(ref: string): string {
  const trimmed = ref.trim();
  const slash = trimmed.lastIndexOf('/');
  const colon = trimmed.lastIndexOf(':');
  if (colon > slash && colon !== -1) return trimmed.slice(colon + 1);
  return DOCKER_UPDATE.STABLE_TAG;
}

export function runningImageRef(): string {
  if (process.env.LUMO_TAMER_IMAGE) return process.env.LUMO_TAMER_IMAGE;
  return `${APP.GHCR_REGISTRY}/${APP.GITHUB_REPO}:${channelImageTag(channelFromVersion(VERSION))}`;
}

function parseVersion(raw: string): { core: number[]; pre: Array<string | number> } {
  const t = raw.trim().replace(/^v/i, '');
  const [corePart, ...preParts] = t.split('-');
  const core = corePart.split('.').map((n) => {
    const v = Number(n);
    return Number.isFinite(v) ? v : 0;
  });
  while (core.length < 3) core.push(0);
  const pre = preParts.join('-').split('.').filter(Boolean).map((p) => {
    const n = Number(p);
    return Number.isFinite(n) && String(n) === p ? n : p;
  });
  return { core: core.slice(0, 3), pre };
}

/** <0 if a < b, 0 if equal, >0 if a > b. Release beats prerelease of the same core. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] - pb.core[i];
  }
  if (pa.pre.length === 0 && pb.pre.length === 0) return 0;
  if (pa.pre.length === 0) return 1;
  if (pb.pre.length === 0) return -1;
  const n = Math.max(pa.pre.length, pb.pre.length);
  for (let i = 0; i < n; i++) {
    const av = pa.pre[i];
    const bv = pb.pre[i];
    if (av === undefined) return -1;
    if (bv === undefined) return 1;
    if (typeof av === 'number' && typeof bv === 'number') {
      if (av !== bv) return av - bv;
      continue;
    }
    const as = String(av);
    const bs = String(bv);
    if (as !== bs) return as < bs ? -1 : 1;
  }
  return 0;
}

function applyHint(opts: {
  cfg: UpdatesConfig;
  action: UpdateAction;
  latest: string | null;
  imageTag: string;
  channelTag: string;
  runningChannel: UpdateChannel;
}): string | null {
  const { cfg, action, latest, channelTag, runningChannel } = opts;
  const target = targetImageRef(cfg.repository, cfg.channel);
  const bits: string[] = [];
  if (action === 'downgrade') {
    bits.push(
      `Stable/main is ${latest}, you are on ${VERSION} (${runningChannel}). ` +
      'That is a downgrade: config.yaml, the vault, and Settings may not load on the older build.',
    );
  } else if (action === 'switch') {
    bits.push(
      `Switch from the ${runningChannel} image to ${cfg.channel} (${latest ?? channelTag}). ` +
      `Set LUMO_TAMER_IMAGE=${target} in .env so the next compose up does not roll back.`,
    );
  }
  if (!dockerSocketAvailable(cfg.dockerSocket)) {
    bits.push(
      `Mount the Docker socket (${cfg.dockerSocket}) to apply from this page, ` +
      `or: docker pull ${target} && docker compose up -d tamer`,
    );
  }
  return bits.length ? bits.join(' ') : null;
}

export function emptyStatus(error: string | null = null): UpdateStatus {
  let cfg: UpdatesConfig;
  try {
    cfg = getUpdatesConfig();
  } catch {
    const imageTag = imageTagFromRef(runningImageRef());
    return {
      enabled: false,
      current: VERSION,
      latest: null,
      latestUrl: null,
      available: false,
      action: 'none',
      channel: 'stable',
      runningChannel: channelFromVersion(VERSION),
      repository: APP.GITHUB_REPO,
      imageTag,
      channelTag: DOCKER_UPDATE.STABLE_TAG,
      canApply: false,
      applyHint: error,
      checkedAt: null,
      error,
    };
  }
  const imageTag = imageTagFromRef(runningImageRef());
  const channelTag = channelImageTag(cfg.channel);
  return {
    enabled: cfg.enabled,
    current: VERSION,
    latest: null,
    latestUrl: null,
    available: false,
    action: 'none',
    channel: cfg.channel,
    runningChannel: channelFromVersion(VERSION),
    repository: cfg.repository,
    imageTag,
    channelTag,
    canApply: false,
    applyHint: null,
    checkedAt: cached?.checkedAt ?? null,
    error,
  };
}

export async function fetchBranchVersion(
  repository: string,
  branch: 'main' | 'dev',
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  const repo = parseRepository(repository);
  const res = await fetcher(`https://raw.githubusercontent.com/${repo}/${branch}/package.json`, {
    headers: { 'User-Agent': `${APP.NAME}/${VERSION}` },
  });
  if (!res.ok) return null;
  try {
    const pkg = await res.json() as { version?: unknown };
    return typeof pkg.version === 'string' && pkg.version.trim() ? pkg.version.trim() : null;
  } catch {
    return null;
  }
}

export async function fetchGithubReleases(
  repository: string,
  fetcher: typeof fetch = fetch,
): Promise<GithubRelease[]> {
  const repo = parseRepository(repository);
  const res = await fetcher(
    `https://api.github.com/repos/${repo}/releases?per_page=${GITHUB.RELEASES_PER_PAGE}`,
    {
      headers: {
        Accept: GITHUB.ACCEPT,
        'User-Agent': `${APP.NAME}/${VERSION}`,
        'X-GitHub-Api-Version': GITHUB.API_VERSION,
      },
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GitHub releases ${res.status}${body ? `: ${body.slice(0, 120)}` : ''}`);
  }
  const data = await res.json() as GithubRelease[];
  if (!Array.isArray(data)) throw new Error('GitHub releases response was not a list');
  return data;
}

export async function checkForUpdate(fetcher: typeof fetch = fetch): Promise<UpdateStatus> {
  const cfg = getUpdatesConfig();
  const base = emptyStatus();
  if (!cfg.enabled) {
    cached = { ...base, error: null };
    return cached;
  }
  try {
    const repo = parseRepository(cfg.repository);
    const releases = await fetchGithubReleases(cfg.repository, fetcher);
    const picked = pickRelease(releases, cfg.channel);
    let latest = picked ? picked.tag_name.replace(/^v/i, '') : null;
    let latestUrl = picked?.html_url ?? null;
    if (!latest) {
      const branch = githubBranchForChannel(cfg.channel);
      const branchVer = await fetchBranchVersion(repo, branch, fetcher);
      if (branchVer && cfg.channel === 'stable' && channelFromVersion(branchVer) === 'dev') {
        latest = null;
      } else if (branchVer) {
        latest = branchVer;
        latestUrl = `https://github.com/${repo}/tree/${branch}`;
      }
    }
    const classified = classifyTrack({
      current: VERSION,
      imageTag: base.imageTag,
      channel: cfg.channel,
      latestOnChannel: latest,
    });
    const noTrack = !latest
      ? (cfg.channel === 'stable'
        ? 'No stable/main release yet (main is still a dev build). This channel will not follow -dev tags.'
        : 'No GitHub releases found for this repository.')
      : null;
    const hint = applyHint({
      cfg,
      action: classified.action,
      latest,
      imageTag: base.imageTag,
      channelTag: base.channelTag,
      runningChannel: classified.runningChannel,
    });
    const available = classified.action !== 'none';
    cached = {
      ...base,
      repository: repo,
      latest,
      latestUrl,
      available,
      action: classified.action,
      runningChannel: classified.runningChannel,
      checkedAt: new Date().toISOString(),
      error: noTrack,
      canApply: available && dockerSocketAvailable(cfg.dockerSocket),
      applyHint: hint,
    };
    return cached;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    cached = { ...base, checkedAt: new Date().toISOString(), error: message, canApply: false };
    return cached;
  }
}

export function getCachedUpdateStatus(): UpdateStatus {
  return cached ?? emptyStatus();
}

export async function applyUpdate(fetcher: typeof fetch = fetch): Promise<{
  ok: boolean;
  status: UpdateStatus;
  message: string;
}> {
  if (applying) {
    return { ok: false, status: getCachedUpdateStatus(), message: 'An update is already running.' };
  }
  const status = cached?.checkedAt ? cached : await checkForUpdate(fetcher);
  if (!status.available) {
    return { ok: false, status, message: status.error || 'Already up to date.' };
  }
  if (!status.canApply) {
    return { ok: false, status, message: status.applyHint || 'Cannot apply this update from here.' };
  }
  const cfg = getUpdatesConfig();
  applying = true;
  try {
    const imageRef = targetImageRef(cfg.repository, cfg.channel);
    const name = process.env.LUMO_CONTAINER_NAME || APP.CONTAINER_NAME;
    logger.info({
      imageRef, name, latest: status.latest, action: status.action,
    }, 'Applying Docker self-update');
    await pullAndSpawnHelper(cfg.dockerSocket, name, imageRef);
    const envHint = ` Set LUMO_TAMER_IMAGE=${imageRef} in .env so compose does not roll back.`;
    return {
      ok: true,
      status,
      message: `Pulled ${imageRef} (${status.latest}). Recreating this container.`
        + (status.action === 'switch' || status.action === 'downgrade' ? envHint : ''),
    };
  } finally {
    applying = false;
  }
}

/** Invoked inside the one-shot helper container (not the live server). */
export async function recreatePeer(name: string): Promise<void> {
  const cfg = getUpdatesConfig();
  const imageRef = runningImageRef();
  const target = name || selfContainerName();
  await recreateContainer(cfg.dockerSocket, target, imageRef);
}

export function startUpdateChecker(): void {
  stopUpdateChecker();
  let cfg: UpdatesConfig;
  try {
    cfg = getUpdatesConfig();
  } catch {
    return;
  }
  if (!cfg.enabled) return;

  const run = async (applyIfDue: boolean) => {
    try {
      const status = await checkForUpdate();
      if (status.available) {
        logger.info({
          current: status.current,
          latest: status.latest,
          channel: status.channel,
        }, 'Update available');
      }
      if (applyIfDue && cfg.autoApply && status.action === 'update' && status.canApply) {
        const result = await applyUpdate();
        logger.info({ message: result.message }, 'Auto-apply started');
      } else if (status.error) {
        logger.warn({ error: status.error }, 'Update check failed');
      }
    } catch (error) {
      logger.warn({ error }, 'Update check failed');
    }
  };

  void run(false);
  const ms = Math.max(1, cfg.checkIntervalHours) * 60 * 60 * 1000;
  checker = setInterval(() => { void run(true); }, ms);
  checker.unref();
}

export function stopUpdateChecker(): void {
  if (checker) {
    clearInterval(checker);
    checker = undefined;
  }
}

/** Test helper. */
export function resetUpdateCache(): void {
  cached = null;
  applying = false;
  stopUpdateChecker();
}
