/**
 * Self-update via the Docker Engine API (unix socket).
 *
 * This process cannot stop-and-recreate itself: stopping the container kills
 * us. After a pull we start a one-shot helper from the *new* image (same
 * socket mount) that recreates lumo-tamer, then we return and get replaced.
 */

import { existsSync } from 'fs';
import http from 'http';
import { APP, DOCKER_UPDATE } from './const.js';
import { logger } from './logger.js';

export type DockerResponse = { status: number; text: string; json: unknown };

export type DockerTransport = (
  method: string,
  path: string,
  body?: unknown,
) => Promise<DockerResponse>;

let transport: DockerTransport | null = null;

export function setDockerTransport(next: DockerTransport | null): void {
  transport = next;
}

export function dockerSocketAvailable(socketPath: string): boolean {
  return existsSync(socketPath);
}

export function splitImageRef(ref: string): { fromImage: string; tag: string } {
  const trimmed = ref.trim();
  const slash = trimmed.lastIndexOf('/');
  const colon = trimmed.lastIndexOf(':');
  if (colon > slash && colon !== -1) {
    return { fromImage: trimmed.slice(0, colon), tag: trimmed.slice(colon + 1) };
  }
  return { fromImage: trimmed, tag: DOCKER_UPDATE.STABLE_TAG };
}

function defaultTransport(socketPath: string): DockerTransport {
  return (method, path, body) => new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({
      socketPath,
      path: path.startsWith(DOCKER_UPDATE.API_PREFIX) ? path : DOCKER_UPDATE.API_PREFIX + path,
      method,
      headers: {
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c as Buffer));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json: unknown = null;
        try { json = text ? JSON.parse(text) : null; } catch { /* NDJSON / empty */ }
        resolve({ status: res.statusCode ?? 0, text, json });
      });
    });
    req.on('error', reject);
    req.setTimeout(DOCKER_UPDATE.REQUEST_TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error('Docker API timeout'));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

async function docker(
  socketPath: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<DockerResponse> {
  const run = transport ?? defaultTransport(socketPath);
  return run(method, path, body);
}

function assertOk(res: DockerResponse, what: string): void {
  if (res.status >= 200 && res.status < 300) return;
  const msg = typeof res.json === 'object' && res.json && 'message' in res.json
    ? String((res.json as { message: string }).message)
    : res.text.slice(0, 200);
  throw new Error(`${what}: Docker API ${res.status}${msg ? ` (${msg})` : ''}`);
}

export async function pullImage(socketPath: string, imageRef: string): Promise<void> {
  const { fromImage, tag } = splitImageRef(imageRef);
  const q = `fromImage=${encodeURIComponent(fromImage)}&tag=${encodeURIComponent(tag)}`;
  logger.info({ imageRef }, 'Pulling image');
  const res = await docker(socketPath, 'POST', `/images/create?${q}`);
  if (res.status >= 400) {
    throw new Error(`Image pull failed: Docker API ${res.status} (${res.text.slice(0, 160)})`);
  }
  if (res.text.includes('"error"')) {
    const errLine = res.text.split('\n').reverse().find((l) => l.includes('"error"'));
    throw new Error(`Image pull failed: ${errLine?.slice(0, 200) || res.text.slice(0, 160)}`);
  }
}

type Inspect = {
  Id: string;
  Name: string;
  Config: Record<string, unknown> & { Image?: string };
  HostConfig: Record<string, unknown>;
  NetworkSettings?: { Networks?: Record<string, { Aliases?: string[]; DriverOpts?: unknown; Links?: string[] }> };
};

export async function inspectContainer(socketPath: string, idOrName: string): Promise<Inspect> {
  const res = await docker(socketPath, 'GET', `/containers/${encodeURIComponent(idOrName)}/json`);
  assertOk(res, `Inspect ${idOrName}`);
  return res.json as Inspect;
}

function createBody(inspect: Inspect, imageRef: string): Record<string, unknown> {
  const networks = inspect.NetworkSettings?.Networks ?? {};
  const endpoints: Record<string, unknown> = {};
  for (const [net, ep] of Object.entries(networks)) {
    endpoints[net] = {
      Aliases: ep.Aliases,
      DriverOpts: ep.DriverOpts,
      Links: ep.Links,
    };
  }
  return {
    ...inspect.Config,
    Image: imageRef,
    HostConfig: inspect.HostConfig,
    NetworkingConfig: { EndpointsConfig: endpoints },
  };
}

/** Recreate a *peer* container. Must not be this process's container. */
export async function recreateContainer(
  socketPath: string,
  name: string,
  imageRef: string,
): Promise<void> {
  const inspect = await inspectContainer(socketPath, name);
  const id = inspect.Id;
  const bare = name.replace(/^\//, '');
  const oldName = `${bare}-preupdate`;

  logger.info({ name: bare, imageRef }, 'Recreating container');
  await docker(socketPath, 'POST', `/containers/${id}/stop?t=${DOCKER_UPDATE.STOP_TIMEOUT_SEC}`);

  try {
    const renamed = await docker(socketPath, 'POST', `/containers/${id}/rename?name=${encodeURIComponent(oldName)}`);
    assertOk(renamed, 'Rename old container');
    const created = await docker(
      socketPath,
      'POST',
      `/containers/create?name=${encodeURIComponent(bare)}`,
      createBody(inspect, imageRef),
    );
    assertOk(created, 'Create replacement');
    const newId = (created.json as { Id: string }).Id;
    const started = await docker(socketPath, 'POST', `/containers/${newId}/start`);
    assertOk(started, 'Start replacement');
    await docker(socketPath, 'DELETE', `/containers/${id}?force=1`);
  } catch (error) {
    logger.error({ error }, 'Recreate failed; trying to start the old container');
    await docker(socketPath, 'POST', `/containers/${id}/rename?name=${encodeURIComponent(bare)}`).catch(() => undefined);
    await docker(socketPath, 'POST', `/containers/${id}/start`).catch(() => undefined);
    throw error;
  }
}

/**
 * Pull `imageRef`, then start a helper from that image that recreates `name`.
 * This process keeps serving until the helper stops it.
 */
export async function pullAndSpawnHelper(
  socketPath: string,
  name: string,
  imageRef: string,
): Promise<void> {
  await pullImage(socketPath, imageRef);

  await docker(socketPath, 'DELETE', `/containers/${DOCKER_UPDATE.HELPER_NAME}?force=1`).catch(() => undefined);

  const helper = await docker(socketPath, 'POST', `/containers/create?name=${DOCKER_UPDATE.HELPER_NAME}`, {
    Image: imageRef,
    Cmd: ['update', 'recreate', name],
    HostConfig: {
      AutoRemove: true,
      Binds: [`${socketPath}:${socketPath}`],
    },
    Env: [`LUMO_TAMER_IMAGE=${imageRef}`],
  });
  assertOk(helper, 'Create updater helper');
  const helperId = (helper.json as { Id: string }).Id;
  const started = await docker(socketPath, 'POST', `/containers/${helperId}/start`);
  assertOk(started, 'Start updater helper');
  logger.info({ helperId: helperId.slice(0, 12), name, imageRef }, 'Updater helper started');
}

export function selfContainerName(): string {
  return process.env.HOSTNAME || APP.CONTAINER_NAME;
}
