import { readFileSync } from 'node:fs';
import pg from 'pg';
import buildDatabase from '../src/global-setup';
import { ADMIN_URL, testDbUrl } from '../src/db';
import { startPostgrest } from '../src/postgrest';

/**
 * Fresh perf database: migrations + fixtures (as the tests), then the volume
 * data set (about 10 minutes). PERF_REUSE_DB=1 benchmarks the database left by
 * a previous run instead.
 */
export default async function perfSetup(): Promise<() => void> {
  if (process.env.PERF_REUSE_DB) {
    const pgrst = await startPostgrest(ADMIN_URL);
    if (!pgrst) throw new Error('PostgREST binary missing: run `pnpm tools:postgrest`.');
    return () => pgrst.kill();
  }
  const stop = await buildDatabase();
  const db = new pg.Client({ connectionString: testDbUrl() });
  await db.connect();
  const started = Date.now();
  try {
    await db.query(readFileSync(new URL('./seed-volume.sql', import.meta.url), 'utf8'));
  } finally {
    await db.end();
  }
  console.log(`Volume data set loaded in ${Math.round((Date.now() - started) / 1000)} s`);
  return stop;
}
