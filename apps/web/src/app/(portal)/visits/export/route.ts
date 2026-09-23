import type { NextRequest } from 'next/server';
import { requireRole } from '@/lib/auth';
import { csvResponse, exportError, fetchAll } from '@/lib/csv-export';
import { visitListQuery } from '@/lib/list-queries';
import { createClient } from '@/lib/supabase/server';
import { parseTableParams } from '@/lib/table-params';

export async function GET(request: NextRequest) {
  await requireRole(['super_admin', 'regional_manager', 'regional_supervisor', 'viewer']);
  const sp = Object.fromEntries(request.nextUrl.searchParams);
  const params = parseTableParams(sp, { sortable: ['started_at'] as const, defaultSort: 'started_at', filters: ['status', 'from', 'to'] });
  const supabase = await createClient();
  try {
    const rows = await fetchAll((from, to) => visitListQuery(supabase, params.q, params.filters).order('started_at', { ascending: false }).range(from, to));
    return await csvResponse(supabase, 'pm_visits_csv', sp, rows, [
      { header: 'Site ID', value: (v) => v.site_code },
      { header: 'Site Name', value: (v) => v.site_name },
      { header: 'Technician', value: (v) => v.technician_name },
      { header: 'Supervisor', value: (v) => v.supervisor_name },
      { header: 'Status', value: (v) => v.status },
      { header: 'Started', value: (v) => v.started_at },
      { header: 'Ended', value: (v) => v.ended_at },
      { header: 'Submitted', value: (v) => v.submitted_at },
      { header: 'Reviewed', value: (v) => v.reviewed_at },
      { header: 'Reviewed By', value: (v) => v.reviewed_by_name },
      { header: 'Review Comments', value: (v) => v.review_comments },
      { header: 'Completion %', value: (v) => v.completion_pct },
      { header: 'Failures', value: (v) => v.failure_count },
      { header: 'GPS Status', value: (v) => v.gps_status },
      { header: 'Template Version', value: (v) => v.template_version },
      { header: 'Demo', value: (v) => (v.is_demo ? 'YES' : 'NO') },
    ]);
  } catch (e) {
    return exportError((e as Error).message);
  }
}

export const dynamic = 'force-dynamic';
