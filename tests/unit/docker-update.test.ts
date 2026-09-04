import { describe, it, expect } from 'vitest';
import { splitImageRef, dockerSocketAvailable } from '../../src/app/docker-update.js';

describe('splitImageRef', () => {
  it('splits registry/name:tag', () => {
    expect(splitImageRef('ghcr.io/banter240/lumo-tamer:dev')).toEqual({
      fromImage: 'ghcr.io/banter240/lumo-tamer',
      tag: 'dev',
    });
    expect(splitImageRef('ghcr.io/banter240/lumo-tamer')).toEqual({
      fromImage: 'ghcr.io/banter240/lumo-tamer',
      tag: 'latest',
    });
  });
});

describe('dockerSocketAvailable', () => {
  it('is false for a missing path', () => {
    expect(dockerSocketAvailable('/no/such/docker.sock')).toBe(false);
  });
});
