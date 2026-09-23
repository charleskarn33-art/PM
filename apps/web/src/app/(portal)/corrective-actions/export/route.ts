import type { NextRequest } from 'next/server';
import { requireSession } from '@/lib/auth';
import { csvResponse, exportError, fetchAll } from '@/lib/csv-export';
import { actionListQuery } from '@/lib/list-queries';
import { createClient } from '@/lib/supabase/server';
import { parseTableParams } from '@/lib/table-params';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const session = await requireSession();
  const sp = Object.fromEntries(request.nextUrl.searchParams);
  const params = parseTableParams(sp, { sortable: ['due_date'] as const, defaultSort: 'due_date', filters: ['status', 'priority', 'overdue', 'mine'] });
  const supabase = await createClient();
  try {
    const rows = await fetchAll((from, to) =>
      actionListQuery(supabase, params.q, params.filters, session.userId).order('due_date', { ascending: true, nullsFirst: false }).range(from, to),
    );
    return await csvResponse(supabase, 'corrective_actions_csv', sp, rows, [
      { header: 'Action No.', value: (a) => a.action_number },
      { header: 'Failure No.', value: (a) => a.failure_number },
      { header: 'Site ID', value: (a) => a.site_code },
      { header: 'Site Name', value: (a) => a.site_name },
      { header: 'Region', value: (a) => a.region_name },
      { header: 'Section', value: (a) => a.category },
      { header: 'Work', value: (a) => a.description },
      { header: 'Priority', value: (a) => a.priority },
      { header: 'Status', value: (a) => a.status },
      { header: 'Assigned To', value: (a) => a.assignee_name },
      { header: 'Assigned By', value: (a) => a.assigned_by_name },
      { header: 'Assigned', value: (a) => a.assigned_at },
      { header: 'Due', value: (a) => a.due_date },
      { header: 'Overdue', value: (a) => (a.is_overdue ? 'YES' : 'NO') },
      { header: 'Completed', value: (a) => a.completed_at },
      { header: 'Resolution', value: (a) => a.resolution },
      { header: 'Verified By', value: (a) => a.verified_by_name },
      { header: 'Verified', value: (a) => a.verified_at },
      { header: 'Closed', value: (a) => a.closed_at },
      { header: 'Demo', value: (a) => (a.is_demo ? 'YES' : 'NO') },
    ]);
  } catch (e) {
    return exportError((e as Error).message);
  }
}
