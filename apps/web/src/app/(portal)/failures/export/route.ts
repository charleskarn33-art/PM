import type { NextRequest } from 'next/server';
import { requireRole } from '@/lib/auth';
import { csvResponse, exportError, fetchAll } from '@/lib/csv-export';
import { failureListQuery } from '@/lib/list-queries';
import { createClient } from '@/lib/supabase/server';
import { parseTableParams } from '@/lib/table-params';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  await requireRole(['super_admin', 'regional_manager', 'regional_supervisor', 'viewer']);
  const sp = Object.fromEntries(request.nextUrl.searchParams);
  const params = parseTableParams(sp, {
    sortable: ['detected_at'] as const,
    defaultSort: 'detected_at',
    filters: ['status', 'severity', 'category', 'source', 'from', 'to'],
  });
  const supabase = await createClient();
  try {
    const rows = await fetchAll((from, to) => failureListQuery(supabase, params.q, params.filters).order('detected_at', { ascending: false }).range(from, to));
    return await csvResponse(supabase, 'failures_csv', sp, rows, [
      { header: 'Failure No.', value: (f) => f.failure_number },
      { header: 'Site ID', value: (f) => f.site_code },
      { header: 'Site Name', value: (f) => f.site_name },
      { header: 'Region', value: (f) => f.region_name },
      { header: 'Section', value: (f) => f.category },
      { header: 'Checklist Item', value: (f) => f.item_prompt },
      { header: 'Description', value: (f) => f.description },
      { header: 'Severity', value: (f) => f.severity },
      { header: 'Status', value: (f) => f.status },
      { header: 'Source', value: (f) => f.source },
      { header: 'Technician', value: (f) => f.technician_name },
      { header: 'Detected', value: (f) => f.detected_at },
      { header: 'Resolved', value: (f) => f.resolved_at },
      { header: 'Verified', value: (f) => f.verified_at },
      { header: 'Closed', value: (f) => f.closed_at },
      { header: 'Closing Note', value: (f) => f.resolution_note },
      { header: 'Corrective Actions', value: (f) => f.action_count },
      { header: 'Open Corrective Actions', value: (f) => f.open_action_count },
      { header: 'Demo', value: (f) => (f.is_demo ? 'YES' : 'NO') },
    ]);
  } catch (e) {
    return exportError((e as Error).message);
  }
}
