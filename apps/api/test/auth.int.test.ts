import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { UsersService } from '../src/users/users.service.js';
import { resetData } from './db.js';
import { makeUser } from './fixtures.js';
import { login, PASSWORD, setPassword, signIn, type Http } from './http.js';
import { startApp, testConfig } from './support.js';

let app: NestExpressApplication;
let http: Http;
let prisma: PrismaService;
let users: UsersService;

beforeAll(async () => {
  // A low limit so the lockout is quick to reach; the auth rate limit is out of the way.
  app = await startApp(testConfig({ AUTH_MAX_FAILED_LOGINS: '3', AUTH_LOCKOUT_MINUTES: '15', AUTH_RATE_LIMIT_PER_MINUTE: '1000' }), false);
  http = app.getHttpServer();
  prisma = app.get(PrismaService);
  users = app.get(UsersService);
});
afterAll(() => app?.close());
beforeEach(() => resetData(prisma));

async function technician() {
  const u = await makeUser(users, ['TECHNICIAN']);
  await setPassword(prisma, u.id);
  return u;
}

describe('sign-in', () => {
  it('returns an access token, a refresh token and the caller’s access; nothing secret is exposed', async () => {
    const u = await technician();
    const res = await login(http, u.email.toUpperCase()).expect(200);
    const d = res.body.data;
    expect(d.tokenType).toBe('Bearer');
    expect(d.accessToken.split('.')).toHaveLength(3);
    expect(d.refreshToken.split('.')).toHaveLength(3);
    expect(new Date(d.accessTokenExpiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(d.user).toMatchObject({ id: u.id, email: u.email, roles: ['TECHNICIAN'], isGlobal: false, mustChangePassword: false });
    expect(d.user.permissions).toContain('pm_visits.perform');
    expect(JSON.stringify(res.body)).not.toMatch(/argon2|passwordHash/);

    const me = await request(http).get('/api/v1/auth/me').set('Authorization', `Bearer ${d.accessToken}`).expect(200);
    expect(me.body.data).toEqual({ ...d.user, regions: [] });
    const row = await prisma.refreshToken.findFirstOrThrow({ where: { userId: u.id } });
    expect(row).toMatchObject({ client: 'web', revokedAt: null });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).lastLoginAt).not.toBeNull();
  });

  it('gives the same answer for an unknown e-mail, a wrong password and an account without a password', async () => {
    const u = await technician();
    const none = await makeUser(users, ['TECHNICIAN']);
    const answers = await Promise.all([
      login(http, 'nobody@example.com'),
      login(http, u.email, 'wrong-password-123'),
      login(http, none.email, PASSWORD),
    ]);
    for (const r of answers) {
      expect(r.status).toBe(401);
      expect(r.body.error.code).toBe('INVALID_CREDENTIALS');
    }
    expect(new Set(answers.map((r) => r.body.error.message)).size).toBe(1);
  });

  it('validates the request', async () => {
    const res = await request(http).post('/api/v1/auth/login').send({ email: 'a@example.com', password: 'x' }).expect(422);
    expect(res.body.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'client' })]));
  });

  it('locks the account after repeated failures, even for the right password, until unlocked', async () => {
    const u = await technician();
    for (let i = 0; i < 3; i++) await login(http, u.email, 'wrong-password-123').expect(401);
    const locked = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(locked.lockedUntil!.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
    const refused = await login(http, u.email).expect(401);
    expect(refused.body.error.code).toBe('INVALID_CREDENTIALS');

    const admin = await makeUser(users, ['SUPER_ADMIN']);
    await setPassword(prisma, admin.id);
    const as = await signIn(http, admin.email);
    await as.post(`/users/${u.id}/unlock`).expect(204);
    await login(http, u.email).expect(200);
  });

  it('a successful sign-in resets the failure count', async () => {
    const u = await technician();
    await login(http, u.email, 'wrong-password-123').expect(401);
    await login(http, u.email, 'wrong-password-123').expect(401);
    await login(http, u.email).expect(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).failedLoginCount).toBe(0);
  });

  it('an inactive user is told so only with the right password', async () => {
    const u = await technician();
    await prisma.user.update({ where: { id: u.id }, data: { isActive: false } });
    expect((await login(http, u.email, 'wrong-password-123')).body.error.code).toBe('INVALID_CREDENTIALS');
    const res = await login(http, u.email).expect(403);
    expect(res.body.error.code).toBe('ACCOUNT_INACTIVE');
  });
});

describe('refresh-token rotation', () => {
  it('each refresh token works once; reuse revokes the whole session family', async () => {
    const u = await technician();
    const first = (await login(http, u.email, PASSWORD, 'mobile').expect(200)).body.data;

    const second = (await request(http).post('/api/v1/auth/refresh').send({ refreshToken: first.refreshToken }).expect(200)).body.data;
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(second.user.id).toBe(u.id);
    const rows = await prisma.refreshToken.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ revokedReason: 'ROTATED', replacedById: rows[1]!.id, client: 'mobile' });
    expect(rows[1]!.familyId).toBe(rows[0]!.familyId);

    // Within the grace period (parallel requests of one client) the old token still works once more…
    const sibling = (await request(http).post('/api/v1/auth/refresh').send({ refreshToken: first.refreshToken }).expect(200)).body.data;
    expect(sibling.refreshToken).not.toBe(second.refreshToken);
    // …after it, presenting the old token again is treated as theft.
    await prisma.refreshToken.update({ where: { id: rows[0]!.id }, data: { revokedAt: new Date(Date.now() - 60_000) } });
    const reuse = await request(http).post('/api/v1/auth/refresh').send({ refreshToken: first.refreshToken }).expect(401);
    expect(reuse.body.error.code).toBe('TOKEN_REUSED');
    // …and the legitimate newer token is revoked with it.
    const after = await request(http).post('/api/v1/auth/refresh').send({ refreshToken: second.refreshToken }).expect(401);
    expect(after.body.error.code).toBe('SESSION_ENDED');
    await request(http).post('/api/v1/auth/refresh').send({ refreshToken: sibling.refreshToken }).expect(401);
    expect((await prisma.refreshToken.findMany({ where: { userId: u.id, revokedAt: null } })).length).toBe(0);
  });

  it('a just-rotated token cannot revive a session that was signed out', async () => {
    const u = await technician();
    const first = (await login(http, u.email).expect(200)).body.data;
    const second = (await request(http).post('/api/v1/auth/refresh').send({ refreshToken: first.refreshToken }).expect(200)).body.data;
    await request(http).post('/api/v1/auth/logout').send({ refreshToken: second.refreshToken }).expect(204);
    // Still inside the grace period, but the session is over.
    const res = await request(http).post('/api/v1/auth/refresh').send({ refreshToken: first.refreshToken }).expect(401);
    expect(res.body.error.code).toBe('TOKEN_REUSED');
    expect(await prisma.refreshToken.count({ where: { userId: u.id, revokedAt: null } })).toBe(0);
  });

  it('parallel refreshes with the same token (one browser, several requests) all succeed in one family', async () => {
    const u = await technician();
    const { refreshToken } = (await login(http, u.email).expect(200)).body.data;
    const results = await Promise.all([1, 2, 3].map(() => request(http).post('/api/v1/auth/refresh').send({ refreshToken })));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    const families = new Set((await prisma.refreshToken.findMany({ where: { userId: u.id } })).map((r) => r.familyId));
    expect(families.size).toBe(1);
  });

  it('without a grace period, the second of two parallel refreshes is refused', async () => {
    const strict = await startApp(testConfig({ AUTH_REFRESH_REUSE_GRACE_SECONDS: '0', AUTH_RATE_LIMIT_PER_MINUTE: '1000' }), false);
    try {
      const h = strict.getHttpServer();
      const u = await technician();
      const { refreshToken } = (await login(h, u.email).expect(200)).body.data;
      const results = await Promise.all([1, 2].map(() => request(h).post('/api/v1/auth/refresh').send({ refreshToken })));
      expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
    } finally {
      await strict.close();
    }
  });

  it('refuses access tokens, forged and malformed tokens', async () => {
    const u = await technician();
    const { accessToken } = (await login(http, u.email).expect(200)).body.data;
    for (const refreshToken of [accessToken, 'garbage', `${accessToken}x`]) {
      const res = await request(http).post('/api/v1/auth/refresh').send({ refreshToken }).expect(401);
      expect(res.body.error.code).toBe('INVALID_TOKEN');
    }
  });

  it('a deactivated user cannot refresh and their access tokens stop working at once', async () => {
    const u = await technician();
    const s = (await login(http, u.email).expect(200)).body.data;
    const admin = await makeUser(users, ['SUPER_ADMIN']);
    await users.setActive(u.id, false, admin.id);
    const me = await request(http).get('/api/v1/auth/me').set('Authorization', `Bearer ${s.accessToken}`).expect(401);
    expect(me.body.error.code).toBe('SESSION_ENDED');
    const r = await request(http).post('/api/v1/auth/refresh').send({ refreshToken: s.refreshToken }).expect(401);
    expect(r.body.error.code).toBe('SESSION_ENDED');
  });
});

describe('sign-out', () => {
  it('logout ends that session only; it is idempotent and accepts an expired access token', async () => {
    const u = await technician();
    const web = (await login(http, u.email, PASSWORD, 'web').expect(200)).body.data;
    const phone = (await login(http, u.email, PASSWORD, 'mobile').expect(200)).body.data;
    await request(http).post('/api/v1/auth/logout').send({ refreshToken: web.refreshToken }).expect(204);
    await request(http).post('/api/v1/auth/logout').send({ refreshToken: web.refreshToken }).expect(204);
    await request(http).post('/api/v1/auth/logout').send({ refreshToken: 'garbage' }).expect(204);
    expect((await request(http).post('/api/v1/auth/refresh').send({ refreshToken: web.refreshToken })).body.error.code).toBe('SESSION_ENDED');
    await request(http).post('/api/v1/auth/refresh').send({ refreshToken: phone.refreshToken }).expect(200);
  });

  it('logout-all ends every session and invalidates access tokens already issued', async () => {
    const u = await technician();
    const a = (await login(http, u.email).expect(200)).body.data;
    const b = (await login(http, u.email, PASSWORD, 'mobile').expect(200)).body.data;
    await request(http).post('/api/v1/auth/logout-all').set('Authorization', `Bearer ${a.accessToken}`).expect(204);
    for (const t of [a.accessToken, b.accessToken]) {
      expect((await request(http).get('/api/v1/auth/me').set('Authorization', `Bearer ${t}`).expect(401)).body.error.code).toBe('SESSION_ENDED');
    }
    await request(http).post('/api/v1/auth/refresh').send({ refreshToken: b.refreshToken }).expect(401);
    // Signing in again straight away works.
    const c = (await login(http, u.email).expect(200)).body.data;
    await request(http).get('/api/v1/auth/me').set('Authorization', `Bearer ${c.accessToken}`).expect(200);
  });
});

describe('passwords', () => {
  it('a temporary password must be changed before anything else; changing it ends other sessions', async () => {
    const admin = await makeUser(users, ['SUPER_ADMIN']);
    await setPassword(prisma, admin.id);
    const as = await signIn(http, admin.email);
    const u = await makeUser(users, ['TECHNICIAN']);

    const weak = await as.post(`/users/${u.id}/temporary-password`, { temporaryPassword: 'short' }).expect(422);
    expect(weak.body.error.details[0].path).toBe('temporaryPassword');
    await as.post(`/users/${u.id}/temporary-password`, { temporaryPassword: 'Temporary-Pass-2026' }).expect(204);

    const s = (await login(http, u.email, 'Temporary-Pass-2026').expect(200)).body.data;
    expect(s.user.mustChangePassword).toBe(true);
    const auth = { Authorization: `Bearer ${s.accessToken}` };
    expect((await request(http).get('/api/v1/sites').set(auth).expect(403)).body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    await request(http).get('/api/v1/auth/me').set(auth).expect(200);

    const other = (await login(http, u.email, 'Temporary-Pass-2026', 'mobile').expect(200)).body.data;
    const wrong = await request(http)
      .post('/api/v1/auth/change-password')
      .set(auth)
      .send({ currentPassword: 'nope', newPassword: 'my-own-long-password', client: 'web' })
      .expect(422);
    expect(wrong.body.error.code).toBe('WRONG_PASSWORD');
    const same = await request(http)
      .post('/api/v1/auth/change-password')
      .set(auth)
      .send({ currentPassword: 'Temporary-Pass-2026', newPassword: 'Temporary-Pass-2026', client: 'web' })
      .expect(422);
    expect(same.body.error.code).toBe('VALIDATION_FAILED');

    const changed = (
      await request(http)
        .post('/api/v1/auth/change-password')
        .set(auth)
        .send({ currentPassword: 'Temporary-Pass-2026', newPassword: 'my-own-long-password', client: 'web' })
        .expect(200)
    ).body.data;
    expect(changed.user.mustChangePassword).toBe(false);
    // The new session works; the old access token and the other device's session do not.
    await request(http).get('/api/v1/sites').set('Authorization', `Bearer ${changed.accessToken}`).expect(200);
    await request(http).get('/api/v1/auth/me').set(auth).expect(401);
    await request(http).post('/api/v1/auth/refresh').send({ refreshToken: other.refreshToken }).expect(401);
    await login(http, u.email, 'Temporary-Pass-2026').expect(401);
    await login(http, u.email, 'my-own-long-password').expect(200);
  });

  it('stores only an Argon2id hash', async () => {
    const admin = await makeUser(users, ['SUPER_ADMIN']);
    await setPassword(prisma, admin.id);
    const as = await signIn(http, admin.email);
    const u = await makeUser(users, ['TECHNICIAN']);
    await as.post(`/users/${u.id}/temporary-password`, { temporaryPassword: 'Temporary-Pass-2026' }).expect(204);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(row.passwordHash).toMatch(/^\$argon2id\$/);
    expect(row.passwordHash).not.toContain('Temporary');
  });
});

describe('sign-in rate limit', () => {
  it('limits sign-in attempts per IP separately from the general limit', async () => {
    const limited = await startApp(testConfig({ AUTH_RATE_LIMIT_PER_MINUTE: '2' }), false);
    try {
      const h = limited.getHttpServer();
      await login(h, 'x@example.com').expect(401);
      await login(h, 'x@example.com').expect(401);
      const res = await login(h, 'x@example.com').expect(429);
      expect(res.body.error.code).toBe('TOO_MANY_REQUESTS');
      // Other routes are unaffected.
      await request(h).get('/api/v1/health').expect(200);
    } finally {
      await limited.close();
    }
  });

  it('with the web forward secret, limits and session records use the browser’s IP', async () => {
    const secret = 'w'.repeat(40);
    const relayed = await startApp(testConfig({ AUTH_RATE_LIMIT_PER_MINUTE: '2', WEB_FORWARD_SECRET: secret }), false);
    try {
      const h = relayed.getHttpServer();
      const from = (ip: string, key = secret) =>
        request(h).post('/api/v1/auth/login').set('X-IPT-Forward-Key', key).set('X-IPT-Client-IP', ip).send({ email: 'x@example.com', password: 'p', client: 'web' });
      await from('203.0.113.1').expect(401);
      await from('203.0.113.1').expect(401);
      await from('203.0.113.1').expect(429);
      // Another browser behind the same web server is not affected…
      await from('203.0.113.2').expect(401);
      // …and a caller without the secret cannot pick an IP.
      await from('203.0.113.3', 'guess').expect(401);
      await from('203.0.113.4', 'guess').expect(401);
      await from('203.0.113.5', 'guess').expect(429);

      const u = await technician();
      await request(h).post('/api/v1/auth/login').set('X-IPT-Forward-Key', secret).set('X-IPT-Client-IP', '198.51.100.9').set('User-Agent', 'Browser/1.0')
        .send({ email: u.email, password: PASSWORD, client: 'web' }).expect(200);
      expect(await prisma.refreshToken.findFirstOrThrow({ where: { userId: u.id } })).toMatchObject({ ipAddress: '198.51.100.9', userAgent: 'Browser/1.0' });
    } finally {
      await relayed.close();
    }
  });
});
