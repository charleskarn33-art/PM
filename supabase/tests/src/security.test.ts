import { afterAll, describe, expect, it } from 'vitest';
import { actAs, getPool, ids, inTx, tryQuery } from './db';

afterAll(async () => {
  await getPool().end();
});

const q = async <T extends Record<string, unknown>>(sql: string) => (await getPool().query<T>(sql)).rows;

/** Catalog-level checks from the Phase 9 security review; they fail if a later migration regresses. */
describe('database security baseline', () => {
  it('every SECURITY DEFINER function pins its search_path', async () => {
    const rows = await q<{ fn: string }>(
      `select n.nspname || '.' || p.proname as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where p.prosecdef and n.nspname in ('public', 'private')
          and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`,
    );
    expect(rows).toEqual([]);
  });

  it('anonymous callers cannot execute any public function or use the private schema', async () => {
    const rows = await q<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')`,
    );
    expect(rows).toEqual([]);
    expect((await q<{ ok: boolean }>(`select has_schema_privilege('anon', 'private', 'usage') as ok`))[0]!.ok).toBe(false);
  });

  it('every public table has at least one RLS policy', async () => {
    const rows = await q<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not exists (select 1 from pg_policy p where p.polrelid = c.oid)`,
    );
    expect(rows).toEqual([]);
  });

  it('every view runs with the caller’s permissions and is read-only', async () => {
    const definer = await q<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('v', 'm')
          and not coalesce(c.reloptions::text[] @> array['security_invoker=true'], false)`,
    );
    expect(definer).toEqual([]);
    const writable = await q<{ table_name: string }>(
      `select distinct g.table_name from information_schema.role_table_grants g
         join information_schema.views v on v.table_schema = g.table_schema and v.table_name = g.table_name
        where g.table_schema = 'public' and g.grantee = 'authenticated' and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE')`,
    );
    expect(writable).toEqual([]);
  });

  it('app users hold no TRUNCATE, REFERENCES or TRIGGER privilege (TRUNCATE would bypass RLS)', async () => {
    const rows = await q<{ table_name: string; privilege_type: string }>(
      `select table_name, privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and grantee in ('authenticated', 'anon')
          and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')`,
    );
    expect(rows).toEqual([]);
    await inTx(async (c) => {
      await actAs(c, ids.admin);
      expect((await tryQuery(c, 'truncate public.audit_logs')).error?.code).toBe('42501');
    });
  });

  it('numbering sequences can be advanced by inserts but not read or reset', async () => {
    await inTx(async (c) => {
      await actAs(c, ids.admin);
      expect((await tryQuery(c, `select setval('public.failure_number_seq', 1)`)).error?.code).toBe('42501');
      expect((await tryQuery(c, `select last_value from public.failure_number_seq`)).error?.code).toBe('42501');
    });
  });

  it('report audit entries are bounded in size', async () => {
    await inTx(async (c) => {
      await actAs(c, ids.viewer);
      await c.query(`select public.record_report_generated('x', jsonb_build_object('q', repeat('a', 5000)), 1)`);
      await actAs(c, ids.admin);
      const { rows } = await c.query(`select metadata from public.audit_logs where action = 'REPORT_GENERATED' and actor_id = $1 order by created_at desc limit 1`, [ids.viewer]);
      expect(JSON.stringify(rows[0].metadata).length).toBeLessThan(1200);
    });
  });

  it('no public function is SECURITY DEFINER unless it checks the caller (allow-list)', async () => {
    // Public SECURITY DEFINER functions are callable through the API; each one
    // below was reviewed to authorise the caller itself before acting.
    const rows = await q<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef order by 1`,
    );
    expect(rows.map((r) => r.proname)).toEqual([
      'admin_activate_template', // Super Admin only
      'admin_clone_template', // Super Admin only
      'admin_set_region_scopes', // Super Admin only
      'admin_update_user', // Super Admin only; cannot demote self
      'corrective_action_assignees', // only for sites the caller manages
      'mark_overdue_schedules', // scheduler or Super Admin
      'pm_visit_issues', // only visits the caller can read
      'record_login', // signed-in caller, own profile
      'record_report_generated', // active users; bounded entry
      'register_push_token', // active users, own token, Expo format only
      'run_daily_notifications', // scheduler or Super Admin
    ]);
  });
});
