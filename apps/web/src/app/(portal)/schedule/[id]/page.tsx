import { PM_STATUS_TONE, SEVERITY_TONE, humanizeStatus } from '@ipt/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { load, loadOptional } from '@/lib/api/data';
import type { Assignment, Schedule } from '@/lib/api/types';
import { hasPermission, requirePermission } from '@/lib/auth';
import { formatDate, formatDateTime } from '@/lib/format';
import { CancelScheduleForm, EditScheduleForm } from '../schedule-forms';

export const metadata: Metadata = { title: 'PM' };

type Detail = Schedule & { visits: { id: string; status: keyof typeof PM_STATUS_TONE; startedAt: string; completedAt: string | null }[] };

export default async function ScheduleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requirePermission('pm_schedules.read');
  const s = await load<Detail>(`/pm-schedules/${id}`);
  const canManage = hasPermission(session, 'pm_schedules.manage') && (session.isGlobal || session.regionIds.includes(s.site.regionId));
  const open = s.status === 'SCHEDULED' || s.status === 'OVERDUE';
  // Technicians who may take this PM: those assigned to the site.
  const assignments = canManage && open ? await loadOptional<Assignment[]>(`/sites/${s.siteId}/assignments`) : null;
  const technicians = (assignments ?? []).filter((a) => a.active && a.role === 'TECHNICIAN').map((a) => ({ id: a.user.id, label: a.user.fullName }));

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title={`PM — ${s.site.siteCode} · ${s.site.siteName}`}
        description={`${s.template.name} v${s.template.version} · ${humanizeStatus(s.frequency)}`}
        actions={<StatusBadge status={s.status} tone={PM_STATUS_TONE[s.status]} />}
      />
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Plan</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Site</dt>
              <dd>
                <Link href={`/sites/${s.site.id}`} className="hover:underline">
                  {s.site.siteCode} · {s.site.siteName}
                </Link>
              </dd>
              <dt className="text-muted-foreground">Technician</dt>
              <dd>{s.technician?.fullName ?? 'Unassigned'}</dd>
              <dt className="text-muted-foreground">Scheduled</dt>
              <dd>{formatDate(s.scheduledDate)}</dd>
              <dt className="text-muted-foreground">Due</dt>
              <dd>{formatDate(s.dueDate)}</dd>
              <dt className="text-muted-foreground">Priority</dt>
              <dd>
                <StatusBadge status={s.priority} tone={SEVERITY_TONE[s.priority]} />
              </dd>
              <dt className="text-muted-foreground">Notes</dt>
              <dd className="whitespace-pre-wrap">{s.notes ?? '—'}</dd>
              {s.cancelReason ? (
                <>
                  <dt className="text-muted-foreground">Cancelled</dt>
                  <dd>{s.cancelReason}</dd>
                </>
              ) : null}
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Visits</CardTitle>
          </CardHeader>
          <CardContent>
            {s.visits.length ? (
              <ul className="divide-y text-sm">
                {s.visits.map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-2 py-2">
                    <Link href={`/visits/${v.id}`} className="hover:underline">
                      Started {formatDateTime(v.startedAt)}
                    </Link>
                    <StatusBadge status={v.status} tone={PM_STATUS_TONE[v.status]} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Not started yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
      {canManage && open ? (
        <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Change</CardTitle>
            </CardHeader>
            <CardContent>
              <EditScheduleForm schedule={s} technicians={technicians} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Cancel</CardTitle>
            </CardHeader>
            <CardContent>
              <CancelScheduleForm id={s.id} />
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
