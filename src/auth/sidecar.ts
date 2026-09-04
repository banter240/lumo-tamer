/**
 * Docker/Portainer Chromium sidecar: CDP defaults, 2028 error copy, teardown.
 *
 * The tamer image has no Chrome. Password login that hits Proton 2028 cannot
 * open a window inside the container. Operators start the optional compose
 * profile, extract over CDP, then remove only the sidecar.
 */

import { APP, CDP, PORTS } from '../app/const.js';

export const DESKTOP_CDP_DEFAULT = CDP.DESKTOP;
export const DOCKER_CDP_DEFAULT = CDP.DOCKER;

export const SIDECAR_NEEDED_ERROR =
  'Proton blocked password login (code 2028). This container cannot open a Chrome window. ' +
  `Start the browser sidecar, sign in at http://<host>:${PORTS.NOVNC}, then run: ` +
  `docker compose run --rm -it tamer auth browser  (CDP ${DOCKER_CDP_DEFAULT}). ` +
  `After tokens are saved, stop and remove only ${APP.BROWSER_CONTAINER_NAME} — leave ${APP.CONTAINER_NAME} (port ${PORTS.TAMER}) running. ` +
  'See “If login fails” on /auth.';

export interface BrowserAuthMode {
  launch: boolean;
  cdpEndpoint: string;
}

/**
 * Inside a container there is no display and no Chrome in the tamer image.
 * Force CDP and prefer the compose service hostname unless the user overrode it.
 */
export function resolveBrowserAuthMode(
  cfg: { launch: boolean; cdpEndpoint: string },
  container: boolean,
): BrowserAuthMode {
  if (!container) {
    return {
      launch: cfg.launch,
      cdpEndpoint: cfg.cdpEndpoint || DESKTOP_CDP_DEFAULT,
    };
  }
  const overridden = cfg.cdpEndpoint && cfg.cdpEndpoint !== DESKTOP_CDP_DEFAULT;
  return {
    launch: false,
    cdpEndpoint: overridden ? cfg.cdpEndpoint : DOCKER_CDP_DEFAULT,
  };
}

/** CLI hint after a successful CDP extraction. Do not stop lumo-tamer. */
export function sidecarTeardownHint(): string {
  return [
    'Sidecar is not needed while tokens are valid. Stop and remove only the browser container:',
    '  docker compose --profile browser stop browser',
    '  docker compose --profile browser rm -f browser',
    'Optional — image and Chromium profile (next start builds/logs in fresh):',
    "  docker rmi $(docker images -q --filter reference='*lumo-tamer*browser*') 2>/dev/null",
    '  # rm -rf ./browser-data',
    `Leave ${APP.CONTAINER_NAME} (port ${PORTS.TAMER}) running. Reload /auth. Empty check:`,
    `  docker ps -a --filter name=${APP.BROWSER_CONTAINER_NAME}`,
  ].join('\n');
}
