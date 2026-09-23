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

function must<T>(label: string, r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(`Unable to load ${label}: ${r.error.message}`);
  return (r.data ?? []) as T;
}

/** All figures are computed by the database as the signed-in user (RLS scope). */
export async function loadCompliance(supabase: Client, from: string, to: string, group: ComplianceGroup, region: string | null) {
  return must<ComplianceRow[]>(
    'PM compliance',
    await supabase.rpc('analytics_pm_compliance', { p_from: from, p_to: to, p_group: group, ...(region ? { p_region: region } : {}) }),
  );
}

export async function loadFailureStats(supabase: Client, from: string, to: string, group: FailureGroup, region: string | null) {
  return must<FailureRow[]>(
    'failure statistics',
    await supabase.rpc('analytics_failures', { p_from: from, p_to: to, p_group: group, ...(region ? { p_region: region } : {}) }),
  );
}

export async function loadTechnicianStats(supabase: Client, from: string, to: string, region: string | null) {
  return must<TechnicianRow[]>(
    'technician performance',
    await supabase.rpc('analytics_technicians', { p_from: from, p_to: to, ...(region ? { p_region: region } : {}) }),
  );
}

export async function loadLatestReadings(supabase: Client, region: string | null) {
  return must<LatestReadingRow[]>('equipment readings', await supabase.rpc('analytics_latest_readings', region ? { p_region: region } : {}));
}
