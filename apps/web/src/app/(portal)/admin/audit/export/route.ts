import type { NextRequest } from 'next/server';
import { describeAuditEntry } from '@/lib/audit';
import { requireCapability } from '@/lib/auth';
import { csvResponse, exportError, fetchAll } from '@/lib/csv-export';
import { auditListQuery } from '@/lib/list-queries';
import { createClient } from '@/lib/supabase/server';
import { parseTableParams } from '@/lib/table-params';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  await requireCapability('view_audit_log');
  const sp = Object.fromEntries(request.nextUrl.searchParams);
  const params = parseTableParams(sp, { sortable: ['created_at'] as const, defaultSort: 'created_at', filters: ['action', 'entity', 'from', 'to'] });
  const supabase = await createClient();
  try {
    const rows = await fetchAll((from, to) => auditListQuery(supabase, params.q, params.filters).order('id', { ascending: false }).range(from, to));
    return await csvResponse(supabase, 'audit_log_csv', sp, rows, [
      { header: 'When (UTC)', value: (r) => r.created_at },
      { header: 'Person', value: (r) => r.actor_name ?? 'System' },
      { header: 'Email', value: (r) => r.actor_email },
      { header: 'Role', value: (r) => r.actor_role },
      { header: 'Action', value: (r) => r.action },
      { header: 'Record Type', value: (r) => r.entity_type },
      { header: 'Record Id', value: (r) => r.entity_id },
      { header: 'Summary', value: (r) => describeAuditEntry(r.action!, r.metadata as never) },
      { header: 'Details (JSON)', value: (r) => JSON.stringify(r.metadata) },
    ]);
  } catch (e) {
    return exportError((e as Error).message);
  }
}
