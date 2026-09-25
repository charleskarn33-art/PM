import { describe, expect, it } from 'vitest';
import { PasswordService } from './password.service.js';

describe('PasswordService', () => {
  const svc = new PasswordService();

  it('hashes with Argon2id and verifies only the right password', async () => {
    const hash = await svc.hash('Correct horse battery 9');
    expect(hash).toMatch(/^\$argon2id\$v=19\$/);
    expect(hash.split('$')[3]!.split(',').sort()).toEqual(['m=19456', 'p=1', 't=2']);
    expect(hash).not.toContain('Correct horse');
    expect(await svc.verify(hash, 'Correct horse battery 9')).toBe(true);
    expect(await svc.verify(hash, 'correct horse battery 9')).toBe(false);
  });

  it('salts every hash and never throws on a malformed hash', async () => {
    expect(await svc.hash('same')).not.toBe(await svc.hash('same'));
    expect(await svc.verify('not-a-hash', 'x')).toBe(false);
  });

  it('flags hashes made with weaker parameters for rehashing', async () => {
    expect(svc.needsRehash(await svc.hash('x'))).toBe(false);
    expect(svc.needsRehash('$argon2id$v=19$m=4096,t=1,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNoaGFzaA')).toBe(true);
  });
});
