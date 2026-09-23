import { toCsv, toIsoDate } from '@ipt/shared';
import { NextResponse, type NextRequest } from 'next/server';
import { parseSiteParams, siteQuery, type SiteOverview } from '@/lib/sites';
import { createClient } from '@/lib/supabase/server';
import { isBeyondLastPage } from '@/lib/table-params';

const MAX_EXPORT_ROWS = 10_000;

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const params = parseSiteParams(Object.fromEntries(request.nextUrl.searchParams));
  const today = toIsoDate(new Date());
  const rows: SiteOverview[] = [];
  // PostgREST caps rows per request; page through the result set.
  for (let page = 1; rows.length < MAX_EXPORT_ROWS; page += 1) {
    const { data, error } = await siteQuery(supabase, { ...params, page, pageSize: 1000 }, today, { paginate: true });
    if (isBeyondLastPage(error)) break; // the previous page ended exactly on the last row
    if (error) return NextResponse.json({ error: `Export failed: ${error.message}` }, { status: 500 });
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  const csv = toCsv(rows, [
    { header: 'Site ID', value: (s) => s.site_code },
    { header: 'Site Name', value: (s) => s.site_name },
    { header: 'Region', value: (s) => s.region_name },
    { header: 'Cluster', value: (s) => s.cluster_name },
    { header: 'County', value: (s) => s.county_name },
    { header: 'Technician', value: (s) => s.technician_names },
    { header: 'Supervisor', value: (s) => s.supervisor_name },
    { header: 'Next PM Status', value: (s) => s.next_pm_status },
    { header: 'Last PM', value: (s) => s.last_pm_at },
    { header: 'Next PM Due', value: (s) => s.next_pm_due },
    { header: 'Open Failures', value: (s) => s.open_failures },
    { header: 'Open Corrective Actions', value: (s) => s.open_corrective_actions },
    { header: 'Site Status', value: (s) => s.status },
    { header: 'Latitude', value: (s) => s.latitude },
    { header: 'Longitude', value: (s) => s.longitude },
    { header: 'Demo', value: (s) => (s.is_demo ? 'YES' : 'NO') },
  ]);

  const { error: auditError } = await supabase.rpc('record_report_generated', {
    p_report: 'sites_csv',
    p_filters: Object.fromEntries(request.nextUrl.searchParams),
    p_row_count: rows.length,
  });
  if (auditError) console.error('record_report_generated failed', auditError.message);

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="sites-${today}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
