import './env';
import { createHmac, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import { deflateSync, crc32 } from 'node:zlib';
import pg from 'pg';
import { testDbUrl } from '../../supabase/tests/src/db';
import { PGRST_URL } from '../../supabase/tests/src/postgrest';
import { E2E } from './env';

/**
 * TEST DOUBLE — end-to-end tests only, never deployed.
 *
 * Stands in for the parts of a Supabase project that cannot run here:
 *   /rest/v1/*     → the real PostgREST on the e2e database (real RLS)
 *   /auth/v1/*     → password sign-in for fixture users (one shared test
 *                    password), token refresh, user lookup, sign-out. Tokens are
 *                    HS256 JWTs signed with PostgREST's test secret, so the
 *                    database sees exactly the claims a real session carries.
 *   /storage/v1/*  → signed URLs for objects recorded in storage.objects and a
 *                    generated PNG as their content.
 */
const JWT_SECRET = 'test-only-jwt-secret-with-at-least-32-characters';
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');

export function signAccessToken(user: { id: string; email: string }, ttlSeconds = 3600): string {
  const header = b64({ alg: 'HS256', typ: 'JWT' });
  const now = Math.floor(Date.now() / 1000);
  const payload = b64({ sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + ttlSeconds });
  const sig = createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

function verify(token: string): { sub: string; email: string } | null {
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) return null;
  const expected = createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest();
  const given = Buffer.from(s, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  if (!claims.sub || claims.exp < Date.now() / 1000) return null;
  return claims;
}

export function sessionFor(user: { id: string; email: string }) {
  const expiresIn = 3600;
  return {
    access_token: signAccessToken(user, expiresIn),
    token_type: 'bearer',
    expires_in: expiresIn,
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    refresh_token: `e2e-refresh.${user.id}`,
    user: userJson(user),
  };
}

function userJson(user: { id: string; email: string }) {
  return { id: user.id, aud: 'authenticated', role: 'authenticated', email: user.email, app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
}

/** A small valid PNG (solid colour) served as every photo's content. */
function png(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, Buffer.from([0x13, 0x30, 0x5a]))]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const PHOTO = png(160, 120);

const readBody = (req: http.IncomingMessage) =>
  new Promise<Buffer>((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });

export async function startGateway(): Promise<{ close: () => Promise<void> }> {
  const db = new pg.Pool({ connectionString: testDbUrl(), max: 2 });
  const json = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const userByEmail = async (email: string) =>
    (await db.query<{ id: string; email: string }>('select id, email from auth.users where lower(email) = lower($1)', [email])).rows[0];
  const userById = async (id: string) => (await db.query<{ id: string; email: string }>('select id, email from auth.users where id = $1', [id])).rows[0];

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://gateway');
      const path = url.pathname;

      if (path === '/auth/v1/token' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req)).toString() || '{}');
        const grant = url.searchParams.get('grant_type');
        let user: { id: string; email: string } | undefined;
        if (grant === 'password' && body.password === E2E.password) user = await userByEmail(String(body.email ?? ''));
        if (grant === 'refresh_token' && String(body.refresh_token ?? '').startsWith('e2e-refresh.')) user = await userById(body.refresh_token.slice(12));
        if (!user) return json(res, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
        return json(res, 200, sessionFor(user));
      }
      if (path === '/auth/v1/user' && req.method === 'GET') {
        const claims = verify((req.headers.authorization ?? '').replace(/^Bearer /, ''));
        if (!claims) return json(res, 401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' });
        return json(res, 200, userJson({ id: claims.sub, email: claims.email }));
      }
      if (path === '/auth/v1/logout') {
        res.writeHead(204);
        return res.end();
      }

      if (path.startsWith('/rest/v1')) {
        const body = await readBody(req);
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string' && !['host', 'content-length', 'connection'].includes(k)) headers.set(k, v);
        const r = await fetch(`${PGRST_URL}${path.slice('/rest/v1'.length)}${url.search}`, {
          method: req.method,
          headers,
          body: req.method === 'GET' || req.method === 'HEAD' ? undefined : new Uint8Array(body),
        });
        const out = Buffer.from(await r.arrayBuffer());
        const h: Record<string, string> = {};
        r.headers.forEach((v, k) => {
          if (!['content-encoding', 'transfer-encoding', 'content-length', 'connection'].includes(k)) h[k] = v;
        });
        res.writeHead(r.status, h);
        return res.end(out);
      }

      const sign = path.match(/^\/storage\/v1\/object\/sign\/([^/]+)$/);
      if (sign && req.method === 'POST') {
        const claims = verify((req.headers.authorization ?? '').replace(/^Bearer /, ''));
        if (!claims) return json(res, 401, { statusCode: '401', error: 'Unauthorized', message: 'invalid JWT' });
        const { paths } = JSON.parse((await readBody(req)).toString()) as { paths: string[] };
        const { rows } = await db.query<{ name: string }>('select name from storage.objects where bucket_id = $1 and name = any($2)', [sign[1], paths]);
        const found = new Set(rows.map((r) => r.name));
        return json(
          res,
          200,
          paths.map((p) => (found.has(p) ? { path: p, error: null, signedURL: `/object/sign/${sign[1]}/${p}?token=e2e` } : { path: p, error: 'Object not found', signedURL: null })),
        );
      }
      if (path.startsWith('/storage/v1/object/sign/') && req.method === 'GET' && url.searchParams.get('token') === 'e2e') {
        res.writeHead(200, { 'content-type': 'image/png', 'content-length': PHOTO.length });
        return res.end(PHOTO);
      }

      json(res, 501, { message: `Not provided by the e2e gateway: ${req.method} ${path}` });
    } catch (e) {
      json(res, 500, { message: (e as Error).message });
    }
  });
  await new Promise<void>((resolve) => server.listen(E2E.gatewayPort, resolve));
  return {
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      await db.end();
    },
  };
}
