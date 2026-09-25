import { readFileSync } from 'node:fs';
import type { PoolConfig } from 'mariadb';

/**
 * Turns DATABASE_URL (mysql://user:pass@host:port/db?options) into the pool
 * settings of the MariaDB/MySQL driver used by Prisma's adapter.
 * Supported options: connectionLimit, connectTimeout, acquireTimeout (ms to wait
 * for a free connection before failing; default 4000), allowPublicKeyRetrieval
 * (only for a database on a private network or localhost — MySQL 8's default
 * authentication needs it without TLS), ssl (true = TLS with certificate
 * verification against the system CAs), sslCa (path to the CA certificate
 * that signed the server's certificate; implies ssl).
 */
export function poolConfigFromUrl(url: string): PoolConfig {
  const u = new URL(url);
  if (u.protocol !== 'mysql:') throw new Error('DATABASE_URL must start with mysql://');
  const database = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (!database) throw new Error('DATABASE_URL must name a database');
  const q = u.searchParams;
  const bool = (k: string) => q.get(k) === 'true';
  const int = (k: string, fallback: number) => {
    const v = q.get(k);
    if (v === null) return fallback;
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) throw new Error(`DATABASE_URL option ${k} must be a positive integer`);
    return n;
  };
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database,
    connectionLimit: int('connectionLimit', 10),
    connectTimeout: int('connectTimeout', 5000),
    acquireTimeout: int('acquireTimeout', 4000),
    allowPublicKeyRetrieval: bool('allowPublicKeyRetrieval'),
    ...(bool('ssl') || q.get('sslCa')
      ? { ssl: { rejectUnauthorized: true, ...(q.get('sslCa') ? { ca: readFileSync(q.get('sslCa')!, 'utf8') } : {}) } }
      : {}),
  };
}
