import { CORRECTIVE_ACTION_STATUS_TONE, humanizeStatus, PM_CATEGORY_LABELS, SEVERITY_TONE } from '@ipt/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { PhotoThumbs } from '@/components/photo-thumbs';
import { StatusBadge } from '@/components/status-badge';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireSession } from '@/lib/auth';
import { loadActionDetail } from '@/lib/corrective-actions';
import { canManageSite, loadAssignees } from '@/lib/failures';
import { signPhotoUrls } from '@/lib/pm-visit';
import { createClient } from '@/lib/supabase/server';
import { CloseWithNoteForm, CompleteForm, EditActionForm, NoteForm, ReturnForm, StatusButton } from '../action-forms';

export const metadata: Metadata = { title: 'Corrective action' };
const DONE_MESSAGES: Record<string, string> = {
  IN_PROGRESS: 'Work started.',
  COMPLETED: 'Marked completed. The supervisor has been notified to verify it.',
  VERIFIED: 'Work verified.',
  CLOSED: 'Corrective action closed.',
  RETURNED: 'Returned to the assignee with your note.',
};
const when = (v: string | null) => (v ? new Date(v).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

export default async function CorrectiveActionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string; done?: string }>;
}) {
  const { id } = await params;
  const { created, done } = await searchParams;
  const session = await requireSession();
  const supabase = await createClient();
  const detail = await loadActionDetail(supabase, id);
  if (!detail) notFound();
  const { action: a, updates, photos } = detail;
  const manage = await canManageSite(supabase, a.site_id!);
  const isAssignee = a.assigned_to === session.userId;
  const assignees = manage ? await loadAssignees(supabase, a.site_id!) : [];
  const photoUrls = await signPhotoUrls(supabase, photos);
  const s = a.status!;
  const open = s === 'OPEN' || s === 'ASSIGNED' || s === 'IN_PROGRESS';

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${a.action_number} · ${a.site_code} ${a.site_name}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {PM_CATEGORY_LABELS[a.category!]}
            <StatusBadge status={a.priority!} tone={SEVERITY_TONE[a.priority!]} />
            <StatusBadge status={s} tone={CORRECTIVE_ACTION_STATUS_TONE[s]} />
            {a.is_overdue ? <Badge tone="danger">Overdue</Badge> : null}
            {a.is_demo ? <Badge>Demo data</Badge> : null}
          </span>
        }
      />
      {done && DONE_MESSAGES[done] ? <Alert tone="success">{DONE_MESSAGES[done]}</Alert> : null}
      {created ? <Alert tone="success">Corrective action created{a.assignee_name ? ` and assigned to ${a.assignee_name}` : ''}.</Alert> : null}

      <Card>
        <CardHeader>
          <CardTitle>Work</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm">{a.description}</p>
          <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Failure</dt>
              <dd className="font-medium">
                {a.failure_id ? (
                  <Link href={`/failures/${a.failure_id}`} className="text-info hover:underline">
                    {a.failure_number}
                  </Link>
                ) : (
                  '—'
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Assigned to</dt>
              <dd className="font-medium">
                {a.assignee_name ?? 'Not assigned'}
                {a.assigned_by_name ? <span className="text-muted-foreground"> by {a.assigned_by_name}</span> : null}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Due</dt>
              <dd className="font-medium">{a.due_date ?? 'No due date'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">PM visit</dt>
              <dd className="font-medium">
                {a.visit_id ? (
                  <Link href={`/visits/${a.visit_id}`} className="text-info hover:underline">
                    Open PM
                  </Link>
                ) : (
                  '—'
                )}
              </dd>
            </div>
          </dl>
          {a.resolution ? <Alert tone={s === 'COMPLETED' ? 'info' : 'success'}>Resolution: {a.resolution}</Alert> : null}
          {a.verified_by_name ? (
            <p className="text-sm text-muted-foreground">
              Verified by {a.verified_by_name} on {when(a.verified_at)}.
            </p>
          ) : null}
          <PhotoThumbs photos={photos} urls={photoUrls} label="Corrective action photos" />
        </CardContent>
      </Card>

      {isAssignee && open ? (
        <Card>
          <CardHeader>
            <CardTitle>Your work</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {s !== 'IN_PROGRESS' ? <StatusButton id={a.id!} status="IN_PROGRESS" label="Start work" /> : null}
            <CompleteForm id={a.id!} />
          </CardContent>
        </Card>
      ) : null}

      {manage && s !== 'CLOSED' ? (
        <Card>
          <CardHeader>
            <CardTitle>Supervisor</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {s === 'COMPLETED' ? (
              <div className="grid gap-6 lg:grid-cols-2">
                <div className="space-y-2">
                  <p className="text-sm">Check the work and photos, then verify it.</p>
                  <StatusButton id={a.id!} status="VERIFIED" label="Verify work" />
                </div>
                <ReturnForm id={a.id!} />
              </div>
            ) : null}
            {s === 'VERIFIED' ? <StatusButton id={a.id!} status="CLOSED" label="Close action" /> : null}
            {open ? (
              <EditActionForm
                action={{ id: a.id!, description: a.description!, priority: a.priority!, assigned_to: a.assigned_to, due_date: a.due_date }}
                assignees={assignees}
              />
            ) : null}
            {open ? <CloseWithNoteForm id={a.id!} /> : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ol className="space-y-3 border-l pl-4">
            <li className="text-sm">
              <span className="text-muted-foreground">{when(a.created_at)}</span> — Created
            </li>
            {updates.map((u) => (
              <li key={u.id} className="text-sm">
                <span className="text-muted-foreground">{when(u.created_at)}</span> — {u.author_name}:{' '}
                {u.to_status ? (
                  <span>
                    {u.from_status ? `${humanizeStatus(u.from_status)} → ` : ''}
                    <strong>{humanizeStatus(u.to_status)}</strong>
                  </span>
                ) : null}
                {u.note ? <span className="block whitespace-pre-line">{u.note}</span> : null}
              </li>
            ))}
          </ol>
          {manage || isAssignee ? <NoteForm id={a.id!} /> : null}
        </CardContent>
      </Card>
    </div>
  );
}
