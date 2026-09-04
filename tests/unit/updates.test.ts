import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('../../src/app/docker-update.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/app/docker-update.js')>();
  return { ...actual, dockerSocketAvailable: () => false };
});

import {
  channelImageTag,
  classifyTrack,
  compareVersions,
  imageTagFromRef,
  parseRepository,
  pickRelease,
  checkForUpdate,
  applyUpdate,
  resetUpdateCache,
  type GithubRelease,
} from '../../src/app/updates.js';

afterEach(() => {
  resetUpdateCache();
  vi.unstubAllGlobals();
  delete process.env.LUMO_TAMER_IMAGE;
  delete process.env.LUMO_CONTAINER_NAME;
});

function release(tag: string, extra: Partial<GithubRelease> = {}): GithubRelease {
  return {
    tag_name: tag,
    prerelease: tag.includes('dev'),
    html_url: `https://github.com/banter240/lumo-tamer/releases/tag/${tag}`,
    published_at: extra.published_at ?? '2026-09-01T00:00:00Z',
    ...extra,
  };
}

describe('parseRepository', () => {
  it('accepts owner/repo and github URLs', () => {
    expect(parseRepository('banter240/lumo-tamer')).toBe('banter240/lumo-tamer');
    expect(parseRepository('https://github.com/banter240/lumo-tamer')).toBe('banter240/lumo-tamer');
    expect(parseRepository('https://github.com/banter240/lumo-tamer.git')).toBe('banter240/lumo-tamer');
  });

  it('rejects junk', () => {
    expect(() => parseRepository('lumo-tamer')).toThrow(/owner\/repo/);
  });
});

describe('compareVersions', () => {
  it('orders core and prerelease the way semver does', () => {
    expect(compareVersions('0.7.0-dev.7', '0.7.0-dev.8')).toBeLessThan(0);
    expect(compareVersions('0.7.0-dev.7', '0.7.0')).toBeLessThan(0);
    expect(compareVersions('0.7.0', '0.7.0-dev.8')).toBeGreaterThan(0);
    expect(compareVersions('v0.7.0', '0.7.0')).toBe(0);
    expect(compareVersions('0.8.0-dev.1', '0.7.0')).toBeGreaterThan(0);
  });
});

describe('image tags', () => {
  it('maps channels and parses compose refs', () => {
    expect(channelImageTag('stable')).toBe('latest');
    expect(channelImageTag('dev')).toBe('dev');
    expect(imageTagFromRef('ghcr.io/banter240/lumo-tamer:dev')).toBe('dev');
    expect(imageTagFromRef('ghcr.io/banter240/lumo-tamer:latest')).toBe('latest');
    expect(imageTagFromRef('ghcr.io/banter240/lumo-tamer')).toBe('latest');
  });
});

describe('pickRelease', () => {
  it('never offers a -dev tag on stable, even if it is newer', () => {
    const list = [
      release('v0.7.0-dev.8', { published_at: '2026-09-03T00:00:00Z' }),
      release('v0.6.0', { published_at: '2026-08-01T00:00:00Z', prerelease: false }),
    ];
    expect(pickRelease(list, 'stable')?.tag_name).toBe('v0.6.0');
    expect(pickRelease(list, 'dev')?.tag_name).toBe('v0.7.0-dev.8');
  });

  it('returns null on stable when main has not shipped', () => {
    expect(pickRelease([release('v0.7.0-dev.8')], 'stable')).toBeNull();
  });
});

describe('classifyTrack', () => {
  it('treats a channel change to an older main release as a downgrade', () => {
    expect(classifyTrack({
      current: '0.7.0-dev.7',
      imageTag: 'dev',
      channel: 'stable',
      latestOnChannel: '0.6.0',
    }).action).toBe('downgrade');
  });

  it('treats a channel change to a same-or-newer main release as a switch', () => {
    expect(classifyTrack({
      current: '0.7.0-dev.7',
      imageTag: 'dev',
      channel: 'stable',
      latestOnChannel: '0.7.0',
    }).action).toBe('switch');
  });

  it('is an update only on the same image tag', () => {
    expect(classifyTrack({
      current: '0.7.0',
      imageTag: 'latest',
      channel: 'stable',
      latestOnChannel: '0.8.0',
    }).action).toBe('update');
  });

  it('is not a switch when you already run that version (compose pin may still say :latest)', () => {
    expect(classifyTrack({
      current: '0.7.0-dev.7',
      imageTag: 'latest',
      channel: 'dev',
      latestOnChannel: '0.7.0-dev.7',
    }).action).toBe('none');
  });
});

describe('checkForUpdate', () => {
  it('sets available when GitHub is ahead of the running version', async () => {
    process.env.LUMO_TAMER_IMAGE = 'ghcr.io/banter240/lumo-tamer:latest';
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify([
        release('v9.9.9', { published_at: '2026-09-04T00:00:00Z', prerelease: false }),
      ]), { status: 200 }),
    ) as unknown as typeof fetch;

    const status = await checkForUpdate(fetcher);
    expect(status.available).toBe(true);
    expect(status.latest).toBe('9.9.9');
    expect(status.channel).toBe('stable');
    expect(fetcher).toHaveBeenCalled();
  });
});

describe('applyUpdate', () => {
  it('refuses when the Docker socket is not mounted', async () => {
    const github = vi.fn(async (url: string) => {
      if (String(url).includes('github.com')) {
        return new Response(JSON.stringify([
          release('v9.9.9', { published_at: '2026-09-04T00:00:00Z', prerelease: false }),
        ]), { status: 200 });
      }
      throw new Error(`unexpected ${url}`);
    }) as unknown as typeof fetch;

    const result = await applyUpdate(github);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/docker\.sock|socket/i);
  });
});
