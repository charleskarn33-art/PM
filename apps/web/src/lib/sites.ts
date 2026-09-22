import 'server-only';
import type { Database, Tables } from '@ipt/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { pageRange, parseTableParams, toIlikePattern, type SearchParams } from '@/lib/table-params';

export type SiteOverview = Tables<'site_overview'>;

export const SITE_SORTS = [
  'site_code',
  'site_name',
  'region_name',
  'cluster_name',
  'county_name',
  'status',
  'last_pm_at',
  'next_pm_due',
  'open_failures',
  'open_corrective_actions',
] as const;
export type SiteSort = (typeof SITE_SORTS)[number];

export const SITE_FILTERS = ['region', 'cluster', 'county', 'status', 'supervisor', 'pm'] as const;

export function parseSiteParams(sp: SearchParams) {
  return parseTableParams<SiteSort>(sp, { sortable: SITE_SORTS, defaultSort: 'site_code', filters: SITE_FILTERS });
}

/**
 * Builds the site_overview query for the list page and CSV export.
 * RLS (via the security-invoker view) limits rows to the caller's scope.
 */
export function siteQuery(
  supabase: SupabaseClient<Database>,
  params: ReturnType<typeof parseSiteParams>,
  today: string,
  opts: { paginate: boolean },
) {
  let query = supabase.from('site_overview').select('*', { count: 'exact' });
  const f = params.filters;
  if (f.region) query = query.eq('region_id', f.region);
  if (f.cluster) query = query.eq('cluster_id', f.cluster);
  if (f.county) query = query.eq('county_id', f.county);
  if (f.status) query = query.eq('status', f.status as Database['public']['Enums']['site_status']);
  if (f.supervisor) query = query.eq('supervisor_id', f.supervisor);
  if (f.pm === 'overdue') {
    query = query.or(`next_pm_status.eq.OVERDUE,next_pm_due.lt.${today}`).not('next_pm_due', 'is', null);
  } else if (f.pm === 'scheduled') {
    query = query.not('next_pm_due', 'is', null).gte('next_pm_due', today);
  } else if (f.pm === 'none') {
    query = query.is('next_pm_due', null);
  }
  if (params.q) {
    const p = toIlikePattern(params.q);
    query = query.or(
      ['site_code', 'site_name', 'county_name', 'cluster_name', 'region_name', 'technician_names', 'supervisor_name']
        .map((c) => `${c}.ilike.${p}`)
        .join(','),
    );
  }
  query = query.order(params.sort, { ascending: params.dir === 'asc', nullsFirst: false });
  if (params.sort !== 'site_code') query = query.order('site_code');
  if (opts.paginate) {
    const { from, to } = pageRange(params.page, params.pageSize);
    query = query.range(from, to);
  }
  return query;
}
