import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
export const SUPABASE_DIR = join(here, '..', '..');

/** Admin connection string for a PostgreSQL server we may create databases on. */
export const ADMIN_URL =
  process.env.TEST_DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
export const TEST_DB_NAME = process.env.TEST_DATABASE_NAME ?? 'ipt_pm_test';

export function testDbUrl(): string {
  const url = new URL(ADMIN_URL);
  url.pathname = `/${TEST_DB_NAME}`;
  return url.toString();
}

/** Shim first, then every migration in filename order, then the demo seed. */
export function schemaSqlFiles(): string[] {
  const migrationsDir = join(SUPABASE_DIR, 'migrations');
  const migrations = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => join(migrationsDir, f));
  return [join(SUPABASE_DIR, 'tests', 'sql', '00_supabase_shim.sql'), ...migrations, join(SUPABASE_DIR, 'seed.sql')];
}

export function readSql(path: string): string {
  return readFileSync(path, 'utf8');
}

// ---------------------------------------------------------------------------
// Fixture identities (created in global-setup)
// ---------------------------------------------------------------------------
export const ids = {
  regionA: '10000000-0000-4000-8000-00000000000a',
  regionB: '10000000-0000-4000-8000-00000000000b',
  clusterA: '20000000-0000-4000-8000-00000000000a',
  countyA: '30000000-0000-4000-8000-00000000000a',
  siteA1: '40000000-0000-4000-8000-0000000000a1',
  siteA2: '40000000-0000-4000-8000-0000000000a2',
  siteB1: '40000000-0000-4000-8000-0000000000b1',
  admin: '50000000-0000-4000-8000-000000000001',
  viewer: '50000000-0000-4000-8000-000000000002',
  managerA: '50000000-0000-4000-8000-000000000003',
  supervisorA: '50000000-0000-4000-8000-000000000004',
  supervisorB: '50000000-0000-4000-8000-000000000005',
  techA: '50000000-0000-4000-8000-000000000006',
  techB: '50000000-0000-4000-8000-000000000007',
  maintenance: '50000000-0000-4000-8000-000000000008',
  inactiveTech: '50000000-0000-4000-8000-000000000009',
} as const;

export type Client = pg.PoolClient;

let pool: pg.Pool | undefined;
export function getPool(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: testDbUrl(), max: 4 });
  return pool;
}

/**
 * Switch the current transaction to act as a Supabase end user.
 * `null` returns to the superuser (trusted server / fixture context).
 */
export async function actAs(client: Client, userId: string | null | 'anon'): Promise<void> {
  await client.query('reset role');
  if (userId === null) {
    await client.query(`select set_config('request.jwt.claims', '', true)`);
    return;
  }
  if (userId === 'anon') {
    await client.query(`select set_config('request.jwt.claims', '{"role":"anon"}', true)`);
    await client.query('set local role anon');
    return;
  }
  await client.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: userId, role: 'authenticated' }),
  ]);
  await client.query('set local role authenticated');
}

/** Run `fn` inside a transaction that is always rolled back. */
export async function inTx<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    return await fn(client);
  } finally {
    await client.query('rollback').catch(() => undefined);
    client.release();
  }
}

/** Run a statement inside a savepoint; returns the error (if any) without aborting the tx. */
export async function tryQuery(
  client: Client,
  sql: string,
  params: unknown[] = [],
): Promise<{ rows: Record<string, unknown>[]; rowCount: number; error?: pg.DatabaseError }> {
  await client.query('savepoint try_query');
  try {
    const result = await client.query(sql, params);
    await client.query('release savepoint try_query');
    return { rows: result.rows, rowCount: result.rowCount ?? 0 };
  } catch (error) {
    await client.query('rollback to savepoint try_query');
    return { rows: [], rowCount: 0, error: error as pg.DatabaseError };
  }
}

export async function activeTemplateId(client: Client): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `select id from public.pm_templates where code = 'TELECOM_SITE_POWER_PM' and status = 'ACTIVE'`,
  );
  if (!rows[0]) throw new Error('Active reference template missing');
  return rows[0].id;
}

export async function itemId(client: Client, code: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `select i.id from public.pm_checklist_items i
       join public.pm_sections s on s.id = i.section_id
       join public.pm_templates t on t.id = s.template_id and t.status = 'ACTIVE'
      where i.code = $1`,
    [code],
  );
  if (!rows[0]) throw new Error(`Checklist item ${code} missing`);
  return rows[0].id;
}

/** Create a PM visit as the given technician (must be assigned to the site). */
export async function createVisitAs(
  client: Client,
  technicianId: string,
  siteId: string,
  status: 'IN_PROGRESS' | 'COMPLETED' | 'SUBMITTED' = 'IN_PROGRESS',
): Promise<string> {
  const templateId = await activeTemplateId(client);
  await actAs(client, technicianId);
  const { rows } = await client.query<{ id: string }>(
    `insert into public.pm_visits (site_id, template_id, technician_id, status, started_at,
                                   gps_latitude, gps_longitude, gps_accuracy_m)
     values ($1, $2, $3, $4, now(), 7.0, -11.0, 5) returning id`,
    [siteId, templateId, technicianId, status],
  );
  return rows[0]!.id;
}
