/**
 * Runtime environment helpers.
 *
 * Docker Compose, Portainer, and k8s restart the PID on exit. A desktop
 * `tsx watch` / hand-started process does not.
 */

import { existsSync } from 'fs';

export function isContainerEnv(): boolean {
  return existsSync('/.dockerenv') || Boolean(process.env.KUBERNETES_SERVICE_HOST);
}
