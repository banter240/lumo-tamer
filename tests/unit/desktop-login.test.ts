import { describe, it, expect } from 'vitest';
import { createCipheriv, randomBytes } from 'crypto';
import { desktopLoginUrl, mailboxPasswordFromProtonBlob } from '../../src/auth/desktop-login.js';

describe('desktop login URL', () => {
  it('points at Proton account desktop login', () => {
    const key = Buffer.alloc(32, 7);
    const url = desktopLoginUrl('USERCODE', key, 'proton-lumo');
    const parsed = new URL(url);
    expect(parsed.origin).toBe('https://account.proton.me');
    expect(parsed.pathname).toBe('/desktop/login');
    expect(parsed.searchParams.get('app')).toBe('proton-lumo');
    expect(parsed.searchParams.get('pv')).toBe('3');
    expect(parsed.hash.startsWith('#payload=')).toBe(true);
    const payload = decodeURIComponent(parsed.hash.slice('#payload='.length));
    const parts = payload.split(':');
    expect(parts[0]).toBe('0');
    expect(parts[1]).toBe('USERCODE');
    expect(parts[3]).toBe('web-lumo');
    expect(Buffer.from(parts[2], 'base64').equals(key)).toBe(true);
  });

  it('unlocks Proton’s mailbox password from the login blob', () => {
    const key = randomBytes(32);
    const nonce = randomBytes(12);
    const plaintext = Buffer.from(JSON.stringify({ keyPassword: 'secret-mailbox' }));
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(Buffer.from('fork'));
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    const blob = Buffer.concat([nonce, encrypted, tag]).toString('base64');
    expect(mailboxPasswordFromProtonBlob(key, blob)).toBe('secret-mailbox');
  });
});
