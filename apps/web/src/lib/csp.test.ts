import { describe, expect, it } from 'vitest';
import { buildCsp, createNonce } from './csp';

describe('buildCsp', () => {
  it('allows scripts only with the nonce, and images and connections only to this site', () => {
    const csp = buildCsp({ nonce: 'abc', dev: false });
    expect(csp).toContain(`script-src 'self' 'nonce-abc' 'strict-dynamic'`);
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain("connect-src 'self';");
    expect(csp).toContain("img-src 'self' data: blob:;");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain('upgrade-insecure-requests');
  });
  it('permits eval only in development, without upgrading to https', () => {
    const csp = buildCsp({ nonce: 'n', dev: true });
    expect(csp).toContain(`'unsafe-eval'`);
    expect(csp).not.toContain('upgrade-insecure-requests');
  });
  it('creates a fresh random nonce each time', () => {
    const a = createNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(createNonce()).not.toBe(a);
  });
});
