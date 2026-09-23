import './env';
import buildDatabase from '../../supabase/tests/src/global-setup';
import { postgrestBinary } from '../../supabase/tests/src/postgrest';
import { db } from './db';
import { startGateway } from './gateway';

/**
 * Fresh database (every migration + seed + the role fixtures used by the
 * database tests), PostgREST on it, and the test gateway in front.
 */
export default async function globalSetup() {
  if (!postgrestBinary()) throw new Error('PostgREST binary missing: run `pnpm tools:postgrest` first.');
  const stopDatabase = await buildDatabase();
  // Review-workflow specs submit PMs without filling in all 69 items; the
  // completeness and evidence rules themselves are covered by the database tests.
  await db().query(`update public.pm_checklist_items set is_required = false, requires_photo_on_failure = false,
      requires_comment_on_failure = false, requires_photo_on_answer = '{}', requires_comment_on_answer = '{}'`);
  await db().query(`update public.pm_reading_fields set is_required = false`);
  await db().end();
  const gateway = await startGateway();
  return async () => {
    await gateway.close();
    stopDatabase();
  };
}
