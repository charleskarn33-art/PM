import { describe, expect, it } from 'vitest';
import { buildCsp, createNonce } from './csp';

describe('buildCsp', () => {
  it('allows scripts only with the nonce and connections only to this site and Supabase', () => {
    const csp = buildCsp({ nonce: 'abc', supabaseUrl: 'https://proj.supabase.co', dev: false });
    expect(csp).toContain(`script-src 'self' 'nonce-abc' 'strict-dynamic'`);
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain('connect-src \'self\' https://proj.supabase.co wss://proj.supabase.co');
    expect(csp).toContain("img-src 'self' data: blob: https://proj.supabase.co");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain('upgrade-insecure-requests');
  });
  it('permits eval only in development and does not upgrade a local http project', () => {
    const csp = buildCsp({ nonce: 'n', supabaseUrl: 'http://localhost:54321/', dev: true });
    expect(csp).toContain(`'unsafe-eval'`);
    expect(csp).toContain('ws://localhost:54321');
    expect(csp).not.toContain('upgrade-insecure-requests');
  });
  it('without a Supabase project, allows only this site', () => {
    const csp = buildCsp({ nonce: 'n', dev: false });
    expect(csp).toContain("connect-src 'self';");
    expect(csp).toContain("img-src 'self' data: blob:;");
    expect(csp).toContain('upgrade-insecure-requests');
    expect(buildCsp({ nonce: 'n', supabaseUrl: 'not a url', dev: false })).toContain("connect-src 'self';");
  });
  it('creates a fresh random nonce each time', () => {
    const a = createNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(createNonce()).not.toBe(a);
  });
});
