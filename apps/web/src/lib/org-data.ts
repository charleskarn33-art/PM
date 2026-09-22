import 'server-only';
import type { Database } from '@ipt/shared';
import type { SupabaseClient } from '@supabase/supabase-js';

type Client = SupabaseClient<Database>;

function unwrap<T>(label: string, result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(`Unable to load ${label}: ${result.error.message}`);
  return result.data as T;
}

export async function loadRegions(supabase: Client) {
  return unwrap('regions', await supabase.from('regions').select('id, code, name, is_active').order('name'));
}

export async function loadClusters(supabase: Client) {
  return unwrap('clusters', await supabase.from('clusters').select('id, code, name, region_id, is_active').order('name'));
}

export async function loadCounties(supabase: Client) {
  return unwrap('counties', await supabase.from('counties').select('id, code, name, cluster_id, is_active').order('name'));
}

export async function loadSupervisors(supabase: Client) {
  const rows = unwrap(
    'supervisors',
    await supabase.from('supervisor_overview').select('id, full_name, email, is_active').order('full_name'),
  );
  return rows.flatMap((r) => (r.id ? [{ id: r.id, name: r.full_name || r.email || r.id, is_active: Boolean(r.is_active) }] : []));
}

export type RegionOption = Awaited<ReturnType<typeof loadRegions>>[number];
export type ClusterOption = Awaited<ReturnType<typeof loadClusters>>[number];
export type CountyOption = Awaited<ReturnType<typeof loadCounties>>[number];
export type SupervisorOption = Awaited<ReturnType<typeof loadSupervisors>>[number];
