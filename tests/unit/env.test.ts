import { describe, it, expect } from 'vitest';
import { isContainerEnv } from '../../src/app/env.js';

describe('isContainerEnv', () => {
  it('is true when Kubernetes injects its service host', () => {
    const prev = process.env.KUBERNETES_SERVICE_HOST;
    process.env.KUBERNETES_SERVICE_HOST = '10.0.0.1';
    try {
      expect(isContainerEnv()).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.KUBERNETES_SERVICE_HOST;
      else process.env.KUBERNETES_SERVICE_HOST = prev;
    }
  });
});
