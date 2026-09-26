import { describe, expect, it } from 'vitest';
import { clientIp } from './client-ip.js';

const SECRET = 's'.repeat(40);
const req = (headers: Record<string, string>, ip = '10.0.0.5') => ({ ip, headers });

describe('clientIp', () => {
  it('uses the forwarded browser IP only with the right shared secret', () => {
    expect(clientIp(req({ 'x-ipt-forward-key': SECRET, 'x-ipt-client-ip': '203.0.113.7' }), SECRET)).toBe('203.0.113.7');
    expect(clientIp(req({ 'x-ipt-forward-key': 'wrong', 'x-ipt-client-ip': '203.0.113.7' }), SECRET)).toBe('10.0.0.5');
    expect(clientIp(req({ 'x-ipt-client-ip': '203.0.113.7' }), SECRET)).toBe('10.0.0.5');
  });

  it('ignores the header when no secret is configured or the value is not an IP', () => {
    expect(clientIp(req({ 'x-ipt-forward-key': SECRET, 'x-ipt-client-ip': '203.0.113.7' }), null)).toBe('10.0.0.5');
    expect(clientIp(req({ 'x-ipt-forward-key': SECRET, 'x-ipt-client-ip': 'evil, 1.2.3.4' }), SECRET)).toBe('10.0.0.5');
    expect(clientIp(req({ 'x-ipt-forward-key': SECRET, 'x-ipt-client-ip': '2001:db8::1' }), SECRET)).toBe('2001:db8::1');
  });
});
