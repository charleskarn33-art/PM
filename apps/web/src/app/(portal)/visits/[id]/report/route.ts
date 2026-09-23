import { isUuid } from '@ipt/shared';
import { renderToBuffer } from '@react-pdf/renderer';
import { NextResponse } from 'next/server';
import { createElement } from 'react';
import { requireSession } from '@/lib/auth';
import { PmReportDocument } from '@/lib/pdf/pm-report';
import { loadPmReportData } from '@/lib/pdf/pm-report-data';
import { reportFileName } from '@/lib/pdf/report-format';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

/** PDF of one PM visit, generated on request for the signed-in user (RLS decides access). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid PM visit' }, { status: 400 });
  const session = await requireSession();
  const supabase = await createClient();
  const data = await loadPmReportData(supabase, id, session.profile.full_name || session.email);
  if (!data) return NextResponse.json({ error: 'PM visit not found' }, { status: 404 });

  const pdf = await renderToBuffer(createElement(PmReportDocument, { data }) as Parameters<typeof renderToBuffer>[0]);

  const { error: auditError } = await supabase.rpc('record_report_generated', {
    p_report: 'pm_visit_pdf',
    p_filters: { visit_id: id },
    p_row_count: 1,
  });
  if (auditError) console.error('record_report_generated failed', auditError.message);

  const name = reportFileName(data.detail.visit.site_code ?? 'site', data.detail.visit.site_name ?? '', data.detail.visit.submitted_at ?? data.detail.visit.started_at);
  const download = new URL(request.url).searchParams.get('download') === '1';
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${name}"`,
      'Cache-Control': 'no-store',
    },
  });
}
