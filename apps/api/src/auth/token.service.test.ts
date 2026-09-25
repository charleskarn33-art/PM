import { JwtService } from '@nestjs/jwt';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../config/app-config.js';
import { TokenService } from './token.service.js';

const config = {
  jwt: { accessSecret: 'a'.repeat(40), refreshSecret: 'b'.repeat(40), accessTtlSeconds: 900, refreshTtlSeconds: 3600 },
} as AppConfig;
const jwt = new JwtService();
const svc = new TokenService(jwt, config);
const USER = '0190f5a2-0000-7000-8000-000000000001';

describe('TokenService', () => {
  it('issues access tokens that verify only as access tokens', async () => {
    const token = await svc.signAccessToken(USER);
    expect(await svc.verifyAccessToken(token)).toMatchObject({ sub: USER, typ: 'access', iss: 'ipt-pm-api', aud: 'ipt-pm' });
    expect(await svc.verifyRefreshToken(token)).toBeNull();
  });

  it('issues refresh tokens with id and family that are refused as access tokens', async () => {
    const token = await svc.signRefreshToken(USER, 'tok-1', 'fam-1');
    expect(await svc.verifyRefreshToken(token)).toMatchObject({ sub: USER, typ: 'refresh', jti: 'tok-1', fam: 'fam-1' });
    expect(await svc.verifyAccessToken(token)).toBeNull();
  });

  it('rejects expired, foreign, unsigned and tampered tokens', async () => {
    const expired = await jwt.signAsync(
      { typ: 'access', exp: Math.floor(Date.now() / 1000) - 10 },
      { secret: config.jwt.accessSecret, subject: USER, issuer: 'ipt-pm-api', audience: 'ipt-pm' },
    );
    const foreign = await jwt.signAsync({ typ: 'access' }, { secret: 'c'.repeat(40), subject: USER, issuer: 'ipt-pm-api', audience: 'ipt-pm' });
    const otherIssuer = await jwt.signAsync({ typ: 'access' }, { secret: config.jwt.accessSecret, subject: USER, issuer: 'x', audience: 'ipt-pm' });
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: USER, typ: 'access', iss: 'ipt-pm-api', aud: 'ipt-pm' })}.`;
    const valid = await svc.signAccessToken(USER);
    const [h, , s] = valid.split('.');
    const tampered = `${h}.${b64({ sub: 'someone-else', typ: 'access', iss: 'ipt-pm-api', aud: 'ipt-pm' })}.${s}`;
    for (const t of [expired, foreign, otherIssuer, unsigned, tampered, 'garbage']) {
      expect(await svc.verifyAccessToken(t)).toBeNull();
    }
  });
});
