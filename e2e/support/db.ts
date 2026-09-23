import './env';
import pg from 'pg';
import { actAs, activeTemplateId, ids, itemId, testDbUrl, type Client } from '../../supabase/tests/src/db';

export { ids };

let pool: pg.Pool | undefined;
export function db(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: testDbUrl(), max: 2 });
  return pool;
}

/** Runs `fn` as the given user (RLS applies) and commits — the browser must see the result. */
export async function asUser<T>(userId: string | null, fn: (c: Client) => Promise<T>): Promise<T> {
  const c = await db().connect();
  try {
    await c.query('begin');
    await actAs(c, userId);
    const result = await fn(c);
    await c.query('commit');
    return result;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

/**
 * What the phone app does for a PM, done directly as the technician: starts a
 * PM at site T-A1 (on site), answers `failing` items NO, records a DC reading
 * and submits. Returns the visit id.
 */
export async function submitPmAsTechnician(failing: string[] = []): Promise<string> {
  return asUser(ids.techA, async (c) => {
    const visitId = (
      await c.query<{ id: string }>(
        `insert into public.pm_visits (site_id, template_id, technician_id, status, started_at, gps_latitude, gps_longitude, gps_accuracy_m)
         values ($1, $2, $3, 'IN_PROGRESS', now() - interval '1 hour', 7.0, -11.0, 5) returning id`,
        [ids.siteA1, await activeTemplateId(c), ids.techA],
      )
    ).rows[0]!.id;
    for (const code of failing) {
      await c.query(`insert into public.pm_responses (visit_id, checklist_item_id, prompt_snapshot, answer, comment) values ($1, $2, '', 'NO', 'Found on site')`, [
        visitId,
        await itemId(c, code),
      ]);
    }
    await c.query(
      `insert into public.pm_readings (visit_id, reading_field_id, label_snapshot, numeric_value)
       select $1, f.id, '', 53.5 from public.pm_reading_fields f join public.pm_sections s on s.id = f.section_id
         join public.pm_templates t on t.id = s.template_id and t.status = 'ACTIVE' where f.code = 'rectifier_output_voltage'`,
      [visitId],
    );
    await c.query(`update public.pm_visits set status = 'SUBMITTED', ended_at = now(), overall_comments = 'E2E PM' where id = $1`, [visitId]);
    return visitId;
  });
}

export async function one<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db().query<T>(sql, params);
  if (!rows[0]) throw new Error(`No row for: ${sql}`);
  return rows[0];
}
