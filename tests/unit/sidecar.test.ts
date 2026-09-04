import { describe, it, expect } from 'vitest';
import {
  DESKTOP_CDP_DEFAULT,
  DOCKER_CDP_DEFAULT,
  SIDECAR_NEEDED_ERROR,
  resolveBrowserAuthMode,
  sidecarTeardownHint,
} from '../../src/auth/sidecar.js';

describe('resolveBrowserAuthMode', () => {
  it('keeps a desktop launch window and localhost CDP', () => {
    expect(resolveBrowserAuthMode({
      launch: true,
      cdpEndpoint: DESKTOP_CDP_DEFAULT,
    }, false)).toEqual({
      launch: true,
      cdpEndpoint: DESKTOP_CDP_DEFAULT,
    });
  });

  it('forces CDP in a container and rewrites the localhost default', () => {
    expect(resolveBrowserAuthMode({
      launch: true,
      cdpEndpoint: DESKTOP_CDP_DEFAULT,
    }, true)).toEqual({
      launch: false,
      cdpEndpoint: DOCKER_CDP_DEFAULT,
    });
  });

  it('keeps an explicit Docker CDP override', () => {
    expect(resolveBrowserAuthMode({
      launch: true,
      cdpEndpoint: 'http://browser:9222',
    }, true)).toEqual({
      launch: false,
      cdpEndpoint: 'http://browser:9222',
    });
  });

  it('keeps a non-default CDP inside the container', () => {
    expect(resolveBrowserAuthMode({
      launch: false,
      cdpEndpoint: 'http://host.docker.internal:9222',
    }, true)).toEqual({
      launch: false,
      cdpEndpoint: 'http://host.docker.internal:9222',
    });
  });
});

describe('sidecar copy', () => {
  it('tells Docker operators not to install Chrome and not to stop tamer', () => {
    expect(SIDECAR_NEEDED_ERROR).toMatch(/2028/);
    expect(SIDECAR_NEEDED_ERROR).toMatch(/cannot open a Chrome window/);
    expect(SIDECAR_NEEDED_ERROR).toMatch(/lumo-tamer-browser/);
    expect(SIDECAR_NEEDED_ERROR).toMatch(/port 3003/);
    expect(SIDECAR_NEEDED_ERROR).not.toMatch(/playwright install/i);
  });

  it('teardown hint stops only the sidecar', () => {
    const hint = sidecarTeardownHint();
    expect(hint).toContain('docker compose --profile browser stop browser');
    expect(hint).toContain('docker compose --profile browser rm -f browser');
    expect(hint).toContain('browser-data');
    expect(hint).toContain('lumo-tamer-browser');
    expect(hint).toMatch(/Leave lumo-tamer \(port 3003\) running/);
    expect(hint).not.toContain('compose down');
  });
});
