import { describe, it, expect } from 'vitest';
import { redactString, redactValue, redactLogArgs } from '../../src/app/log-redact.js';

describe('log-redact', () => {
  it('strips emails and bearer tokens from strings', () => {
    expect(redactString('login as jane.doe@proton.me with Bearer abcdef')).toBe(
      'login as [Redacted] with Bearer [Redacted]',
    );
  });

  it('redacts login fields on objects', () => {
    const out = redactValue({
      username: 'jane.doe@proton.me',
      password: 'secret',
      uid: 'uid-123',
      accessToken: 'tok',
      sync: true,
    }) as Record<string, unknown>;

    expect(out.username).toBe('[Redacted]');
    expect(out.password).toBe('[Redacted]');
    expect(out.uid).toBe('[Redacted]');
    expect(out.accessToken).toBe('[Redacted]');
    expect(out.sync).toBe(true);
  });

  it('redacts nested tokens without touching tool-call JSON', () => {
    const tool = '{"name":"user:read","arguments":{"filePath":"/tmp/a.py"}}';
    const out = redactValue({
      tokens: { email: 'a@b.co', refreshToken: 'r' },
      msg: tool,
    }) as Record<string, unknown>;

    expect(out.tokens).toBe('[Redacted]');
    expect(out.msg).toBe(tool);
  });

  it('redacts emails inside Error messages', () => {
    const out = redactValue(new Error('Authentication failed: jane@proton.me')) as {
      message: string;
    };
    expect(out.message).toBe('Authentication failed: [Redacted]');
    expect(out.message).not.toContain('proton.me');
  });

  it('keeps Proton status/Code/body on Error objects', () => {
    const err = new Error('API error: 400 Bad Request') as Error & {
      status?: number;
      Code?: number;
      body?: string;
    };
    err.status = 400;
    err.Code = 2028;
    err.body = '{"Code":2028,"Error":"fail jane@proton.me"}';
    const out = redactValue(err) as Record<string, unknown>;
    expect(out.status).toBe(400);
    expect(out.Code).toBe(2028);
    expect(out.body).toBe('{"Code":2028,"Error":"fail [Redacted]"}');
  });

  it('maps pino log args', () => {
    const [obj, msg] = redactLogArgs([
      { username: 'x', tool: 'read' },
      'user jane@x.tld',
    ]) as [Record<string, unknown>, string];
    expect(obj.username).toBe('[Redacted]');
    expect(obj.tool).toBe('read');
    expect(msg).toBe('user [Redacted]');
  });
});
