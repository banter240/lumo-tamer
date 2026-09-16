import { describe, it, expect } from 'vitest';
import { systemOpenArgs } from '../../src/app/open-url.js';

describe('systemOpenArgs', () => {
  it('uses the OS opener on each platform', () => {
    expect(systemOpenArgs('http://127.0.0.1:3003/auth', 'win32')).toEqual({
      cmd: 'cmd',
      args: ['/c', 'start', '', 'http://127.0.0.1:3003/auth'],
    });
    expect(systemOpenArgs('http://127.0.0.1:3003/auth', 'darwin')).toEqual({
      cmd: 'open',
      args: ['http://127.0.0.1:3003/auth'],
    });
    expect(systemOpenArgs('http://127.0.0.1:3003/auth', 'linux')).toEqual({
      cmd: 'xdg-open',
      args: ['http://127.0.0.1:3003/auth'],
    });
  });
});
