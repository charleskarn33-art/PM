import { CORRECTIVE_ACTION_STATUS_TONE, FAILURE_STATUS_TONE, PM_CATEGORY_LABELS, SEVERITY_TONE } from '@ipt/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { AttachmentList, Timeline } from '@/components/timeline';
import { Alert } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { load, loadAll, loadOptional } from '@/lib/api/data';
import type { ActionStatus, Assignment, Attachment, FailureStatus, Severity, TimelineEntry, UserSummary } from '@/lib/api/types';
import { hasPermission, requirePermission } from '@/lib/auth';
import { formatDate, formatDateTime } from '@/lib/format';
import { AttachmentForm, CloseReopenForm, CommentForm, CreateActionForm, EditFailureForm, RemoveAttachmentButton } from '../failure-forms';

export const metadata: Metadata = { title: 'Failure' };

interface Failure {
  id: string;
  number: string;
  source: 'PM_CHECKLIST' | 'MANUAL';
  title: string;
  description: string | null;
  severity: Severity;
  status: FailureStatus;
  category: string | null;
  sectionCode: string | null;
  stillReported: boolean;
  detectedAt: string;
  resolvedAt: string | null;
  verifiedAt: string | null;
  closedAt: string | null;
  closeNote: string | null;
  isDemo: boolean;
  site: { id: string; siteCode: string; siteName: string; regionId: string };
  visit: { id: string; status: string; startedAt: string; completedAt: string | null } | null;
  reportedBy: { id: string; fullName: string } | null;
  closedBy: { fullName: string } | null;
  actions: { id: string; number: string; title: string; status: ActionStatus; priority: Severity; dueDate: string | null; assignedTo: { fullName: string } | null }[];
  updates: TimelineEntry[];
  attachments: Attachment[];
}

const ACTIVE: ActionStatus[] = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED'];

export default async function FailurePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requirePermission('failures.read');
  const f = await load<Failure>(`/failures/${id}`);
  const managesRegion = session.isGlobal || session.regionIds.includes(f.site.regionId);
  const canManage = hasPermission(session, 'failures.manage') && managesRegion;
  const canCreateAction = hasPermission(session, 'corrective_actions.manage') && managesRegion && f.status !== 'CLOSED';
  // Who may comment and attach: reporters, managers, and assignees of an action (the API checks which).
  const canContribute = ['failures.report', 'failures.manage', 'corrective_actions.manage', 'corrective_actions.work'].some((p) => hasPermission(session, p));
  const closed = f.status === 'CLOSED';

  // People who may be given the work: technicians assigned to the site and maintenance users (the API checks each).
  let assignees: { id: string; label: string }[] = [];
  if (canCreateAction) {
    const [assignments, maintenance] = await Promise.all([
      loadOptional<Assignment[]>(`/sites/${f.site.id}/assignments`),
      hasPermission(session, 'users.read') ? loadAll<UserSummary>('/users?role=MAINTENANCE_USER&active=true') : Promise.resolve([] as UserSummary[]),
    ]);
    assignees = [
      ...(assignments ?? []).filter((a) => a.active && a.role === 'TECHNICIAN').map((a) => ({ id: a.user.id, label: `${a.user.fullName} (technician)` })),
      ...maintenance.map((u) => ({ id: u.id, label: `${u.fullName} (maintenance)` })),
    ];
  }
  const actionNumbers = new Map(f.actions.map((a) => [a.id, a.number]));
  const openActions = f.actions.filter((a) => ACTIVE.includes(a.status)).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${f.number} · ${f.title}`}
        description={
          <>
            <Link href={`/sites/${f.site.id}`} className="hover:underline">
              {f.site.siteCode} · {f.site.siteName}
            </Link>
            {' · '}
            {f.source === 'MANUAL' ? `Reported on site by ${f.reportedBy?.fullName ?? '—'}` : 'Recorded from a completed PM'} · {formatDateTime(f.detectedAt)}
          </>
        }
        actions={
          <>
            <StatusBadge status={f.severity} tone={SEVERITY_TONE[f.severity]} />
            <StatusBadge status={f.status} tone={FAILURE_STATUS_TONE[f.status]} />
          </>
        }
      />
      {f.isDemo ? <Alert tone="info">Demo data — not a live failure.</Alert> : null}
      {!f.stillReported ? <Alert tone="warning">No longer reported: the PM was corrected and completed again. Work already started on it is kept.</Alert> : null}
      {closed && f.closeNote ? (
        <Alert tone="info">
          Closed by {f.closedBy?.fullName ?? '—'} on {formatDateTime(f.closedAt)}: {f.closeNote}
        </Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {f.description ? <p className="whitespace-pre-wrap">{f.description}</p> : <p className="text-muted-foreground">No description.</p>}
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                <dt className="text-muted-foreground">Area</dt>
                <dd>{f.category ? (PM_CATEGORY_LABELS[f.category as keyof typeof PM_CATEGORY_LABELS] ?? f.category) : '—'}</dd>
                {f.visit ? (
                  <>
                    <dt className="text-muted-foreground">PM visit</dt>
                    <dd>
                      <Link href={`/visits/${f.visit.id}`} className="hover:underline">
                        {formatDate(f.visit.startedAt)}
                      </Link>
                    </dd>
                  </>
                ) : null}
                <dt className="text-muted-foreground">Resolved</dt>
                <dd>{formatDateTime(f.resolvedAt)}</dd>
                <dt className="text-muted-foreground">Verified</dt>
                <dd>{formatDateTime(f.verifiedAt)}</dd>
                <dt className="text-muted-foreground">Closed</dt>
                <dd>{formatDateTime(f.closedAt)}</dd>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Corrective actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {f.actions.length ? (
                <ul className="divide-y text-sm">
                  {f.actions.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                      <Link href={`/corrective-actions/${a.id}`} className="min-w-0 hover:underline">
                        <span className="font-medium">{a.number}</span> — {a.title}
                        <span className="block text-xs text-muted-foreground">
                          {a.assignedTo?.fullName ?? 'Not assigned'}
                          {a.dueDate ? ` · due ${formatDate(a.dueDate)}` : ''}
                        </span>
                      </Link>
                      <StatusBadge status={a.status} tone={CORRECTIVE_ACTION_STATUS_TONE[a.status]} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No corrective action yet.</p>
              )}
              {canCreateAction ? (
                <details className="rounded-lg border p-3" open={f.actions.length === 0}>
                  <summary className="cursor-pointer text-sm font-medium">New corrective action</summary>
                  <div className="pt-3">
                    <CreateActionForm failureId={f.id} assignees={assignees} title={f.title} />
                  </div>
                </details>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Photos and documents</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <AttachmentList
                failureId={f.id}
                files={f.attachments}
                remove={(a) => (!closed && (a.uploadedBy.id === session.userId || canManage) ? <RemoveAttachmentButton failureId={f.id} attachmentId={a.id} /> : null)}
              />
              {!closed && canContribute ? <AttachmentForm failureId={f.id} /> : null}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Timeline</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Timeline entries={f.updates} actionNumbers={actionNumbers} />
              {canContribute ? <CommentForm failureId={f.id} /> : null}
            </CardContent>
          </Card>
          {canManage && !closed ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Edit</CardTitle>
              </CardHeader>
              <CardContent>
                <EditFailureForm failure={f} />
              </CardContent>
            </Card>
          ) : null}
          {canManage ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{closed ? 'Reopen' : 'Close without further action'}</CardTitle>
              </CardHeader>
              <CardContent>
                {!closed && openActions ? (
                  <p className="text-sm text-muted-foreground">{openActions} corrective action{openActions === 1 ? ' is' : 's are'} still open; finish or withdraw them first.</p>
                ) : (
                  <CloseReopenForm id={f.id} closed={closed} />
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
