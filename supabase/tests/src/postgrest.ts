import { spawn, type ChildProcess } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PostgrestClient } from '@supabase/postgrest-js';
import type { Database } from '@ipt/shared';
import { SUPABASE_DIR, TEST_DB_NAME } from './db';

export const PGRST_PORT = Number(process.env.TEST_POSTGREST_PORT ?? 3999);
export const PGRST_URL = `http://localhost:${PGRST_PORT}`;
const JWT_SECRET = 'test-only-jwt-secret-with-at-least-32-characters';

export function postgrestBinary(): string | null {
  const bin = process.env.POSTGREST_BIN ?? join(SUPABASE_DIR, '..', '.tools', 'postgrest');
  return existsSync(bin) ? bin : null;
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

/** HS256 JWT shaped like a Supabase access token. */
export function signJwt(sub: string | null): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify(
      sub
        ? { sub, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }
        : { role: 'anon', exp: Math.floor(Date.now() / 1000) + 3600 },
    ),
  );
  const signature = createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

/** A PostgREST client acting as the given user (null = anon). */
export function apiAs(userId: string | null): PostgrestClient<Database> {
  return new PostgrestClient<Database>(PGRST_URL, {
    headers: { Authorization: `Bearer ${signJwt(userId)}` },
    fetch: rollbackFetch,
  });
}

/** Adds `tx=rollback` to every request so API tests leave the database unchanged. */
const rollbackFetch: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers);
  const prefer = headers.get('Prefer');
  headers.set('Prefer', prefer ? `${prefer},tx=rollback` : 'tx=rollback');
  return fetch(input, { ...init, headers });
};

export async function startPostgrest(adminUrl: string): Promise<ChildProcess | null> {
  const bin = postgrestBinary();
  if (!bin) return null;
  const dbUri = new URL(adminUrl);
  dbUri.username = 'authenticator';
  dbUri.password = 'authenticator';
  dbUri.pathname = `/${TEST_DB_NAME}`;
  const proc = spawn(bin, [], {
    env: {
      ...process.env,
      PGRST_DB_URI: dbUri.toString(),
      PGRST_DB_SCHEMAS: 'public',
      PGRST_DB_ANON_ROLE: 'anon',
      PGRST_JWT_SECRET: JWT_SECRET,
      PGRST_SERVER_PORT: String(PGRST_PORT),
      PGRST_DB_MAX_ROWS: '1000',
      PGRST_LOG_LEVEL: 'error',
      // Lets tests send `Prefer: tx=rollback` so API calls never persist.
      PGRST_DB_TX_END: 'commit-allow-override',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  for (let i = 0; i < 100; i += 1) {
    try {
      const res = await fetch(`${PGRST_URL}/`);
      if (res.status < 500) return proc;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.kill();
  throw new Error('PostgREST did not start within 10 seconds');
}
