/**
 * Response times of the real web loaders and mobile sync, through PostgREST,
 * for each role, on the two-year / 1,200-site data set (perf/seed-volume.sql).
 *
 * Run with `pnpm --filter @ipt/db-tests perf`. Budgets are regression guards
 * for this data set on a developer machine, not product limits.
 */
import type { Database } from '@ipt/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadCompliance, loadFailureStats, loadLatestReadings, loadTechnicianStats } from '@/lib/analytics';
import { loadActionDetail } from '@/lib/corrective-actions';
import { loadDashboard, monthPeriod } from '@/lib/dashboard';
import { loadFailureDetail } from '@/lib/failures';
import { actionListQuery, auditListQuery, failureListQuery, visitListQuery } from '@/lib/list-queries';
import { loadVisitAnalytics, loadVisitDetail } from '@/lib/pm-visit';
import { parseSiteParams, siteQuery } from '@/lib/sites';
import { getPool, ids } from '../src/db';
import { apiAs } from '../src/postgrest';

type Api = SupabaseClient<Database>;
const as = (id: string) => apiAs(id) as unknown as Api;
const today = new Date().toISOString().slice(0, 10);
const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);

interface Result {
  case: string;
  role: string;
  rows: number | string;
  median_ms: number;
  max_ms: number;
  budget_ms: number;
}
const results: Result[] = [];

async function measure(name: string, role: string, budgetMs: number, fn: () => Promise<{ error?: unknown; rows?: number }>) {
  const first = await fn(); // warm-up (plans, caches)
  expect(first.error ?? null, `${name} (${role})`).toBeNull();
  const times: number[] = [];
  for (let i = 0; i < 5; i += 1) {
    const t = performance.now();
    await fn();
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  const r = { case: name, role, rows: first.rows ?? '', median_ms: Math.round(times[2]!), max_ms: Math.round(times[4]!), budget_ms: budgetMs };
  results.push(r);
  return r;
}

const people: Record<string, string> = {};
let visitId = '';
let failureId = '';
let actionId = '';

beforeAll(async () => {
  const pool = getPool();
  const byEmail = async (email: string) => (await pool.query<{ id: string }>('select id from public.profiles where email = $1', [email])).rows[0]!.id;
  people.supervisor = await byEmail('supervisor.1@perf.local');
  people.manager = await byEmail('manager.1@perf.local');
  people.technician = await byEmail('technician.1@perf.local');
  people.maintenance = await byEmail('maintenance.1@perf.local');
  people.admin = ids.admin;
  visitId = (await pool.query(`select id from public.pm_visits where technician_id = $1 and failure_count > 0 order by submitted_at desc limit 1`, [people.technician])).rows[0].id;
  failureId = (await pool.query(`select id from public.failures where visit_id = $1 limit 1`, [visitId])).rows[0].id;
  actionId = (await pool.query(`select id from public.corrective_actions where assigned_to = $1 order by created_at desc limit 1`, [people.technician])).rows[0].id;
  const counts = (
    await pool.query(`select (select count(*) from public.sites)::int sites, (select count(*) from public.pm_visits)::int visits,
      (select count(*) from public.pm_responses)::int responses, (select count(*) from public.pm_readings)::int readings,
      (select count(*) from public.pm_photos)::int photos, (select count(*) from public.failures)::int failures,
      (select count(*) from public.corrective_actions)::int actions, (select count(*) from public.notifications)::int notifications,
      (select count(*) from public.audit_logs)::int audit_entries`)
  ).rows[0];
  console.log('Data set:', counts);
});

afterAll(async () => {
  console.table(results);
  await getPool().end();
});

const rows = (r: { data: unknown; error: unknown; count?: number | null }) => ({
  error: r.error,
  rows: r.count ?? (Array.isArray(r.data) ? r.data.length : r.data ? 1 : 0),
});

describe('web pages (first page of each list, default sort)', () => {
  for (const role of ['admin', 'manager', 'supervisor'] as const) {
    it(`dashboard, lists and analytics as ${role}`, async () => {
      const api = as(people[role]!);
      const cases: [string, number, () => Promise<{ error?: unknown; rows?: number }>][] = [
        ['dashboard', 1000, async () => ({ error: null, rows: Object.keys(await loadDashboard(api, monthPeriod(new Date()))).length })],
        ['sites list', 500, async () => rows(await siteQuery(api, parseSiteParams({}), today, { paginate: true }))],
        ['sites list: search', 500, async () => rows(await siteQuery(api, parseSiteParams({ q: 'Site 1-1' }), today, { paginate: true }))],
        ['sites list: PM overdue', 500, async () => rows(await siteQuery(api, parseSiteParams({ pm: 'overdue' }), today, { paginate: true }))],
        ['PM visits list', 500, async () => rows(await visitListQuery(api, '', { status: 'ALL' }).order('submitted_at', { ascending: false, nullsFirst: false }).range(0, 24))],
        ['PM visits: awaiting review', 500, async () => rows(await visitListQuery(api, '', {}).order('submitted_at', { ascending: false, nullsFirst: false }).range(0, 24))],
        ['failures list', 500, async () => rows(await failureListQuery(api, '', {}).order('detected_at', { ascending: false }).range(0, 24))],
        ['corrective actions list', 500, async () => rows(await actionListQuery(api, '', {}, people[role]!).order('due_date', { ascending: true, nullsFirst: false }).range(0, 24))],
        ['analytics: compliance by month (12 m)', 1500, async () => ({ error: null, rows: (await loadCompliance(api, yearAgo, today, 'month', null)).length })],
        ['analytics: compliance by technician', 1500, async () => ({ error: null, rows: (await loadCompliance(api, yearAgo, today, 'technician', null)).length })],
        ['analytics: failures by item', 1500, async () => ({ error: null, rows: (await loadFailureStats(api, yearAgo, today, 'item', null)).length })],
        ['analytics: technician performance', 1500, async () => ({ error: null, rows: (await loadTechnicianStats(api, yearAgo, today, null)).length })],
        ['analytics: latest readings', 1500, async () => ({ error: null, rows: (await loadLatestReadings(api, null)).length })],
      ];
      for (const [name, budget, fn] of cases) await measure(name, role, budget, fn);
    });
  }

  it('record pages and the audit log', async () => {
    const sup = as(people.supervisor!);
    await measure('PM visit detail (+ analytics)', 'supervisor', 800, async () => {
      const [d, a] = await Promise.all([loadVisitDetail(sup, visitId), loadVisitAnalytics(sup, visitId)]);
      return { error: d ? null : 'not found', rows: d?.responses.length ?? 0, ...(a ? {} : { error: 'no analytics' }) };
    });
    await measure('failure detail', 'supervisor', 500, async () => ({ error: (await loadFailureDetail(sup, failureId)) ? null : 'not found', rows: 1 }));
    await measure('corrective action detail', 'supervisor', 500, async () => ({ error: (await loadActionDetail(sup, actionId)) ? null : 'not found', rows: 1 }));
    await measure('audit log (page 1)', 'admin', 800, async () =>
      rows(await auditListQuery(as(people.admin!), '', {}).order('created_at', { ascending: false }).order('id', { ascending: false }).range(0, 24)),
    );
  });

  it('a full CSV export page (1,000 PM visits)', async () => {
    await measure('PM visits export page (1,000 rows)', 'admin', 2000, async () =>
      rows(await visitListQuery(as(people.admin!), '', { status: 'ALL' }).order('submitted_at', { ascending: false }).range(0, 999)),
    );
  });
});

describe('mobile', () => {
  it('technician sync download and maintenance sync download', async () => {
    for (const role of ['technician', 'maintenance'] as const) {
      await measure('mobile sync bundle', role, 1500, async () => {
        const r = await apiAs(people[role]!).rpc('mobile_sync_bundle');
        const b = r.data as { sites?: unknown[] } | null;
        return { error: r.error, rows: b?.sites?.length ?? 0 };
      });
    }
  });
});

describe('budgets', () => {
  it('results are complete, not cut at the 1,000-row response limit', () => {
    const readings = results.find((r) => r.case === 'analytics: latest readings' && r.role === 'admin');
    expect(readings?.rows).toBe(1200); // every perf site has submitted PMs
  });

  it('every case is within its budget', () => {
    const over = results.filter((r) => r.median_ms > r.budget_ms);
    expect(over).toEqual([]);
  });
});
