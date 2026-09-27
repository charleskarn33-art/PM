import { CORRECTIVE_ACTION_STATUS_TONE, FAILURE_STATUS_TONE, SEVERITY_TONE } from '@ipt/shared';
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
import { AttachmentForm, CommentForm, RemoveAttachmentButton } from '../../failures/failure-forms';
import { AssignForm, CloseForm, CompleteForm, EditActionForm, StartForm, VerifyForm } from '../action-forms';

export const metadata: Metadata = { title: 'Corrective action' };

interface Action {
  id: string;
  number: string;
  title: string;
  description: string | null;
  priority: Severity;
  status: ActionStatus;
  dueDate: string | null;
  assignedToId: string | null;
  assignedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  completedById: string | null;
  completionNote: string | null;
  verifiedAt: string | null;
  verificationNote: string | null;
  closedAt: string | null;
  closeNote: string | null;
  isDemo: boolean;
  site: { id: string; siteCode: string; siteName: string; regionId: string };
  failure: { id: string; number: string; title: string; severity: Severity; status: FailureStatus; description: string | null };
  assignedTo: { id: string; fullName: string } | null;
  assignedBy: { fullName: string } | null;
  completedBy: { fullName: string } | null;
  verifiedBy: { fullName: string } | null;
  closedBy: { fullName: string } | null;
  updates: TimelineEntry[];
  attachments: Attachment[];
}

const DONE: Record<string, string> = {
  start: 'Work started.',
  complete: 'Marked completed. A supervisor will verify the work.',
  verify: 'Work verified.',
  reject: 'Sent back for rework.',
  close: 'Action closed.',
  assign: 'Assignment saved.',
};

export default async function ActionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string }> }) {
  const { id } = await params;
  const { done } = await searchParams;
  const session = await requirePermission('corrective_actions.read');
  const a = await load<Action>(`/corrective-actions/${id}`);
  const ids = { id: a.id, failureId: a.failure.id };
  const manages = hasPermission(session, 'corrective_actions.manage') && (session.isGlobal || session.regionIds.includes(a.site.regionId));
  const mine = a.assignedToId === session.userId && hasPermission(session, 'corrective_actions.work');
  const didTheWork = a.assignedToId === session.userId || a.completedById === session.userId;
  const closed = a.status === 'CLOSED';
  let assignees: { id: string; label: string }[] = [];
  if (manages && ['OPEN', 'ASSIGNED', 'IN_PROGRESS'].includes(a.status)) {
    const [assignments, maintenance] = await Promise.all([
      loadOptional<Assignment[]>(`/sites/${a.site.id}/assignments`),
      hasPermission(session, 'users.read') ? loadAll<UserSummary>('/users?role=MAINTENANCE_USER&active=true') : Promise.resolve([] as UserSummary[]),
    ]);
    assignees = [
      ...(assignments ?? []).filter((x) => x.active && x.role === 'TECHNICIAN').map((x) => ({ id: x.user.id, label: `${x.user.fullName} (technician)` })),
      ...maintenance.map((u) => ({ id: u.id, label: `${u.fullName} (maintenance)` })),
    ];
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${a.number} · ${a.title}`}
        description={
          <Link href={`/sites/${a.site.id}`} className="hover:underline">
            {a.site.siteCode} · {a.site.siteName}
          </Link>
        }
        actions={
          <>
            <StatusBadge status={a.priority} tone={SEVERITY_TONE[a.priority]} />
            <StatusBadge status={a.status} tone={CORRECTIVE_ACTION_STATUS_TONE[a.status]} />
          </>
        }
      />
      {done && DONE[done] ? <Alert tone="success">{DONE[done]}</Alert> : null}
      {a.isDemo ? <Alert tone="info">Demo data — not live work.</Alert> : null}
      {a.status === 'IN_PROGRESS' && a.verificationNote ? <Alert tone="danger">Sent back: {a.verificationNote}</Alert> : null}

      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Work</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {a.description ? <p className="whitespace-pre-wrap">{a.description}</p> : null}
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                <dt className="text-muted-foreground">Failure</dt>
                <dd>
                  <Link href={`/failures/${a.failure.id}`} className="hover:underline">
                    {a.failure.number} — {a.failure.title}
                  </Link>{' '}
                  <StatusBadge status={a.failure.status} tone={FAILURE_STATUS_TONE[a.failure.status]} />
                </dd>
                <dt className="text-muted-foreground">Assigned to</dt>
                <dd>{a.assignedTo ? `${a.assignedTo.fullName} (by ${a.assignedBy?.fullName ?? '—'}, ${formatDateTime(a.assignedAt)})` : 'Not assigned'}</dd>
                <dt className="text-muted-foreground">Due</dt>
                <dd>{formatDate(a.dueDate)}</dd>
                <dt className="text-muted-foreground">Started</dt>
                <dd>{formatDateTime(a.startedAt)}</dd>
                <dt className="text-muted-foreground">Completed</dt>
                <dd>{a.completedAt ? `${formatDateTime(a.completedAt)} by ${a.completedBy?.fullName ?? '—'}` : '—'}</dd>
                {a.completionNote ? (
                  <>
                    <dt className="text-muted-foreground">What was done</dt>
                    <dd className="whitespace-pre-wrap">{a.completionNote}</dd>
                  </>
                ) : null}
                <dt className="text-muted-foreground">Verified</dt>
                <dd>{a.verifiedAt ? `${formatDateTime(a.verifiedAt)} by ${a.verifiedBy?.fullName ?? '—'}` : '—'}</dd>
                <dt className="text-muted-foreground">Closed</dt>
                <dd>{a.closedAt ? `${formatDateTime(a.closedAt)} by ${a.closedBy?.fullName ?? '—'}${a.closeNote ? ` — ${a.closeNote}` : ''}` : '—'}</dd>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Photos and documents</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <AttachmentList
                failureId={a.failure.id}
                files={a.attachments}
                remove={(f) => (!closed && (f.uploadedBy.id === session.userId || manages) ? <RemoveAttachmentButton failureId={a.failure.id} attachmentId={f.id} /> : null)}
              />
              {!closed && (mine || manages) ? <AttachmentForm failureId={a.failure.id} actionId={a.id} /> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Timeline</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Timeline entries={a.updates} />
              {!closed ? <CommentForm failureId={a.failure.id} actionId={a.id} /> : null}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {mine && a.status === 'ASSIGNED' ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Your work</CardTitle>
              </CardHeader>
              <CardContent>
                <StartForm {...ids} />
              </CardContent>
            </Card>
          ) : null}
          {mine && a.status === 'IN_PROGRESS' ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Complete</CardTitle>
              </CardHeader>
              <CardContent>
                <CompleteForm {...ids} />
              </CardContent>
            </Card>
          ) : null}
          {manages && a.status === 'COMPLETED' ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Verify the work</CardTitle>
              </CardHeader>
              <CardContent>{didTheWork ? <p className="text-sm text-muted-foreground">You did this work, so another supervisor must verify it.</p> : <VerifyForm {...ids} />}</CardContent>
            </Card>
          ) : null}
          {manages && assignees.length + (a.assignedToId ? 1 : 0) > 0 && ['OPEN', 'ASSIGNED', 'IN_PROGRESS'].includes(a.status) ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Assignment</CardTitle>
              </CardHeader>
              <CardContent>
                <AssignForm {...ids} assignees={assignees} current={a.assignedToId} dueDate={a.dueDate} />
              </CardContent>
            </Card>
          ) : null}
          {manages && (a.status === 'VERIFIED' || a.status === 'OPEN' || a.status === 'ASSIGNED') ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{a.status === 'VERIFIED' ? 'Close' : 'Withdraw'}</CardTitle>
              </CardHeader>
              <CardContent>
                <CloseForm {...ids} withdraw={a.status !== 'VERIFIED'} />
              </CardContent>
            </Card>
          ) : null}
          {manages && !closed ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Edit</CardTitle>
              </CardHeader>
              <CardContent>
                <EditActionForm action={a} />
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
