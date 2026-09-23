import 'server-only';
import type { Database } from '@ipt/shared';
import type { SupabaseClient } from '@supabase/supabase-js';

type Client = SupabaseClient<Database>;
type Fn = Database['public']['Functions'];
export type ComplianceRow = Fn['analytics_pm_compliance']['Returns'][number];
export type FailureRow = Fn['analytics_failures']['Returns'][number];
export type TechnicianRow = Fn['analytics_technicians']['Returns'][number];
export type LatestReadingRow = Fn['analytics_latest_readings']['Returns'][number];

export type ComplianceGroup = 'region' | 'county' | 'technician' | 'supervisor' | 'month';
export type FailureGroup = 'category' | 'severity' | 'month' | 'item' | 'site';

/** PostgREST returns at most this many rows per request. */
const PAGE = 1000;

/**
 * Runs an analytics function and returns every row: results larger than one
 * response (e.g. latest readings for more than 1,000 sites) are fetched page
 * by page. Each function orders its rows, so pages are stable.
 */
async function all<T>(
  label: string,
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const r = await page(from, from + PAGE - 1);
    if (r.error) throw new Error(`Unable to load ${label}: ${r.error.message}`);
    const data = (r.data ?? []) as T[];
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

/** All figures are computed by the database as the signed-in user (RLS scope). */
export async function loadCompliance(supabase: Client, from: string, to: string, group: ComplianceGroup, region: string | null) {
  const args = { p_from: from, p_to: to, p_group: group, ...(region ? { p_region: region } : {}) };
  return all<ComplianceRow>('PM compliance', (a, b) => supabase.rpc('analytics_pm_compliance', args).range(a, b));
}

export async function loadFailureStats(supabase: Client, from: string, to: string, group: FailureGroup, region: string | null) {
  const args = { p_from: from, p_to: to, p_group: group, ...(region ? { p_region: region } : {}) };
  return all<FailureRow>('failure statistics', (a, b) => supabase.rpc('analytics_failures', args).range(a, b));
}

export async function loadTechnicianStats(supabase: Client, from: string, to: string, region: string | null) {
  const args = { p_from: from, p_to: to, ...(region ? { p_region: region } : {}) };
  return all<TechnicianRow>('technician performance', (a, b) => supabase.rpc('analytics_technicians', args).range(a, b));
}

export async function loadLatestReadings(supabase: Client, region: string | null) {
  const args = region ? { p_region: region } : {};
  return all<LatestReadingRow>('equipment readings', (a, b) => supabase.rpc('analytics_latest_readings', args).range(a, b));
}
