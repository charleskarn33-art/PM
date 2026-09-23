import {
  can,
  CORRECTIVE_ACTION_STATUS_TONE,
  FAILURE_STATUS_TONE,
  humanizeStatus,
  PM_CATEGORY_LABELS,
  priorityForSeverity,
  SEVERITY_TONE,
} from '@ipt/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { PhotoThumbs } from '@/components/photo-thumbs';
import { StatusBadge } from '@/components/status-badge';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requireRole } from '@/lib/auth';
import { canManageSite as checkManage, loadAssignees, loadFailureDetail } from '@/lib/failures';
import { signPhotoUrls } from '@/lib/pm-visit';
import { createClient } from '@/lib/supabase/server';
import { CloseFailureForm, CreateActionForm, ReopenFailureForm, SeverityForm } from '../failure-forms';

export const metadata: Metadata = { title: 'Failure' };
const when = (v: string | null) => (v ? new Date(v).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

export default async function FailurePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireRole(['super_admin', 'regional_manager', 'regional_supervisor', 'viewer']);
  const supabase = await createClient();
  const detail = await loadFailureDetail(supabase, id);
  if (!detail) notFound();
  const { failure: f, actions, photos } = detail;
  const manage = can(session.role, 'manage_corrective_actions');
  const canManageSite = manage && (await checkManage(supabase, f.site_id!));
  const assignees = canManageSite ? await loadAssignees(supabase, f.site_id!) : [];
  const photoUrls = await signPhotoUrls(supabase, photos);
  const openActions = actions.filter((a) => a.status !== 'VERIFIED' && a.status !== 'CLOSED');

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${f.failure_number} · ${f.site_code} ${f.site_name}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {PM_CATEGORY_LABELS[f.category!]}
            <StatusBadge status={f.severity!} tone={SEVERITY_TONE[f.severity!]} />
            <StatusBadge status={f.status!} tone={FAILURE_STATUS_TONE[f.status!]} />
            {f.is_demo ? <Badge>Demo data</Badge> : null}
          </span>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>What was found</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm">{f.description}</p>
          <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Source</dt>
              <dd className="font-medium">
                {f.source === 'PM_CHECKLIST' && f.visit_id ? (
                  <Link href={`/visits/${f.visit_id}`} className="text-info hover:underline">
                    PM checklist
                  </Link>
                ) : (
                  'Reported manually'
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Checklist item</dt>
              <dd className="font-medium">{f.item_prompt ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Detected</dt>
              <dd className="font-medium">
                {when(f.detected_at)}
                {f.technician_name ? ` by ${f.technician_name}` : ''}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Region</dt>
              <dd className="font-medium">{f.region_name ?? '—'}</dd>
            </div>
          </dl>
          <PhotoThumbs photos={photos} urls={photoUrls} label="Evidence photos" />
          {f.status === 'CLOSED' && f.resolution_note ? <Alert tone="info">Closed: {f.resolution_note}</Alert> : null}
          {canManageSite ? <SeverityForm id={f.id!} severity={f.severity!} /> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Corrective actions</CardTitle>
          <CardDescription>The failure&apos;s status follows its corrective actions.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {actions.length === 0 ? <p className="text-sm text-muted-foreground">No corrective action yet.</p> : null}
          <ul className="divide-y">
            {actions.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span>
                  <Link href={`/corrective-actions/${a.id}`} className="font-medium hover:underline">
                    {a.action_number}
                  </Link>{' '}
                  {a.description}
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-muted-foreground">{a.assignee_name ?? 'Unassigned'}</span>
                  {a.is_overdue ? <Badge tone="danger">Overdue</Badge> : null}
                  <StatusBadge status={a.status!} tone={CORRECTIVE_ACTION_STATUS_TONE[a.status!]} />
                </span>
              </li>
            ))}
          </ul>
          {canManageSite && f.status !== 'CLOSED' ? (
            <div className="rounded-lg border p-4">
              <p className="mb-3 text-sm font-medium">New corrective action</p>
              <CreateActionForm
                failure={{ id: f.id!, site_id: f.site_id!, category: f.category! }}
                assignees={assignees}
                defaults={{ description: `Repair: ${f.item_prompt ?? f.description}`, priority: priorityForSeverity(f.severity!) }}
              />
            </div>
          ) : null}
        </CardContent>
      </Card>

      {canManageSite ? (
        <Card>
          <CardHeader>
            <CardTitle>{f.status === 'CLOSED' ? 'Reopen' : 'Close without further work'}</CardTitle>
          </CardHeader>
          <CardContent>
            {f.status === 'CLOSED' ? (
              <ReopenFailureForm id={f.id!} />
            ) : openActions.length > 0 ? (
              <p className="text-sm text-muted-foreground">
                {openActions.length} corrective action(s) are still {openActions.map((a) => humanizeStatus(a.status!).toLowerCase()).join(', ')}; the failure closes when they do.
              </p>
            ) : (
              <CloseFailureForm id={f.id!} />
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
