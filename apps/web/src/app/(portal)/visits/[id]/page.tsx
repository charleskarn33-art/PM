import {
  can,
  formatDistance,
  humanizeStatus,
  ISSUE_LABELS,
  isFailure,
  PM_CATEGORY_LABELS,
  PM_STATUS_TONE,
  SEVERITY_TONE,
  visitProgress,
  type Tables,
} from '@ipt/shared';
import { Camera, MessageSquare } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { PhotoThumbs } from '@/components/photo-thumbs';
import { SectionSummary } from '@/components/section-summary';
import { StatusBadge } from '@/components/status-badge';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireRole } from '@/lib/auth';
import { loadVisitDetail, signPhotoUrls } from '@/lib/pm-visit';
import { createClient } from '@/lib/supabase/server';
import { cn } from '@/lib/utils';
import { ReviewForm } from './review-form';

export const metadata: Metadata = { title: 'PM visit' };
const when = (v: string | null) => (v ? new Date(v).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

function formatValue(item: Tables<'pm_checklist_items'>, r: Tables<'pm_responses'> | undefined): string | null {
  if (!r) return null;
  if (item.response_type === 'YES_NO_NA') return null;
  if (r.answer === 'N/A') return 'N/A';
  switch (item.response_type) {
    case 'NUMBER':
      return r.numeric_value == null ? null : `${r.numeric_value}${item.unit ? ` ${item.unit}` : ''}`;
    case 'MULTI_SELECT':
      return r.selected_options?.join(', ') ?? null;
    case 'DATE':
      return r.date_value;
    case 'DATETIME':
      return r.datetime_value ? when(r.datetime_value) : null;
    default:
      return r.text_value;
  }
}

export default async function VisitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireRole(['super_admin', 'regional_manager', 'regional_supervisor', 'viewer']);
  const supabase = await createClient();
  const detail = await loadVisitDetail(supabase, id);
  if (!detail) notFound();
  const { visit, raw, sections, items, readingFields, responses, readings, photoCounts, photos, issues, state, analytics, dcThresholds } = detail;
  const photoUrls = await signPhotoUrls(supabase, photos);
  const photosFor = (itemId: string) => photos.filter((p) => p.checklist_item_id === itemId);

  const progress = visitProgress(state);
  const responseBy = new Map(responses.map((r) => [r.checklist_item_id, r]));
  const readingBy = new Map(readings.map((r) => [r.reading_field_id, r]));
  const issueBy = new Map<string, string[]>();
  for (const i of issues) issueBy.set(i.refId, [...(issueBy.get(i.refId) ?? []), ISSUE_LABELS[i.issue]]);
  const na = new Set(raw.not_applicable_sections);
  const canReview = can(session.role, 'review_pm') && visit.status === 'SUBMITTED';

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${visit.site_code} · ${visit.site_name}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            PM by {visit.technician_name}
            <StatusBadge status={visit.status!} tone={PM_STATUS_TONE[visit.status!]} />
            {visit.is_demo ? <Badge>Demo data</Badge> : null}
          </span>
        }
        actions={
          <Link href={`/sites/${visit.site_id}`} className={buttonVariants({ variant: 'outline' })}>
            Site
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {[
          ['Completion', `${visit.completion_pct}%`],
          ['Failures', String(visit.failure_count)],
          ['Started', when(visit.started_at)],
          ['Submitted', when(visit.submitted_at)],
          ['Photos', String(photos.length)],
        ].map(([label, value]) => (
          <Card key={label} className="p-4">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={cn('mt-1 font-semibold', label === 'Failures' && Number(value) > 0 && 'text-danger')}>{value}</p>
          </Card>
        ))}
      </div>

      <GpsCheckIn visit={raw} />

      {visit.reviewed_at && (visit.status === 'APPROVED' || visit.status === 'REJECTED') ? (
        <Alert tone={visit.status === 'REJECTED' ? 'danger' : 'success'}>
          <strong>
            {visit.status === 'APPROVED' ? 'Approved' : 'Rejected'} by {visit.reviewed_by_name ?? 'supervisor'}
          </strong>{' '}
          on {when(visit.reviewed_at)}
          {visit.review_comments ? `: ${visit.review_comments}` : '.'}
        </Alert>
      ) : visit.review_comments ? (
        <Alert tone="info">Previous review: {visit.review_comments}</Alert>
      ) : null}

      {issues.length > 0 && visit.status !== 'APPROVED' ? (
        <Alert tone="warning">
          {issues.length} item{issues.length === 1 ? '' : 's'} still incomplete (answers, comments or photos). The technician cannot
          submit until they are resolved.
        </Alert>
      ) : null}

      {canReview ? (
        <Card>
          <CardHeader>
            <CardTitle>Review</CardTitle>
          </CardHeader>
          <CardContent>
            <ReviewForm visitId={id} />
          </CardContent>
        </Card>
      ) : null}

      {sections
        .filter((s) => s.is_active)
        .map((section) => {
          const p = progress.sections.find((x) => x.code === section.code);
          const sectionItems = items.filter((i) => i.section_id === section.id && i.is_active);
          const sectionFields = readingFields.filter((f) => f.section_id === section.id && f.is_active);
          return (
            <Card key={section.id} className={cn(na.has(section.code) && 'opacity-70')}>
              <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
                <CardTitle>{section.name}</CardTitle>
                <span className="flex items-center gap-2 text-sm">
                  {na.has(section.code) ? (
                    <Badge>Not applicable</Badge>
                  ) : (
                    <>
                      <span className="text-muted-foreground">
                        {p?.done ?? 0}/{p?.required ?? 0} required
                      </span>
                      {p?.failures ? <Badge tone="danger">{p.failures} failure(s)</Badge> : null}
                    </>
                  )}
                </span>
              </CardHeader>
              {na.has(section.code) ? null : (
                <CardContent className="space-y-4">
                  {issues
                    .filter((i) => i.issue === 'INCONSISTENT' && i.sectionCode === section.code)
                    .map((i) => (
                      <Alert key={i.refId} tone="warning">
                        {i.label}
                      </Alert>
                    ))}
                  {sectionFields.length > 0 ? (
                    <dl className="grid gap-3 rounded-lg bg-muted/50 p-3 sm:grid-cols-2 lg:grid-cols-3">
                      {sectionFields.map((f) => {
                        const r = readingBy.get(f.id);
                        const value = r ? (r.numeric_value ?? r.text_value) : null;
                        return (
                          <div key={f.id}>
                            <dt className="text-xs text-muted-foreground">{f.label}</dt>
                            <dd className={cn('font-semibold tabular-nums', value == null && f.is_required && 'text-warning')}>
                              {value == null ? (f.is_required ? 'Missing' : '—') : `${value}${f.unit && r?.numeric_value != null ? ` ${f.unit}` : ''}`}
                            </dd>
                          </div>
                        );
                      })}
                    </dl>
                  ) : null}
                  <SectionSummary category={section.category} analytics={analytics} dcThresholds={dcThresholds} />
                  <PhotoThumbs
                    photos={photos.filter((p) => !p.checklist_item_id && p.section_id === section.id)}
                    urls={photoUrls}
                    label={`${section.name} photos`}
                  />
                  <ul className="divide-y">
                    {sectionItems.map((item) => {
                      const r = responseBy.get(item.id);
                      const failed = isFailure(item, r?.answer);
                      const value = formatValue(item, r);
                      const itemIssues = issueBy.get(item.id);
                      return (
                        <li key={item.id} className={cn('flex flex-col gap-1 py-2.5 sm:flex-row sm:items-start sm:justify-between', failed && 'bg-danger-soft/40 -mx-2 px-2 rounded')}>
                          <div className="min-w-0">
                            <p className="text-sm">
                              {r?.prompt_snapshot ?? item.prompt}
                              {!item.is_required ? <span className="ml-1 text-xs text-muted-foreground">(optional)</span> : null}
                            </p>
                            {r?.comment ? (
                              <p className="mt-1 flex items-start gap-1 text-xs text-muted-foreground">
                                <MessageSquare className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                                {r.comment}
                              </p>
                            ) : null}
                            {itemIssues ? <p className="mt-1 text-xs font-medium text-warning">{itemIssues.join(' · ')}</p> : null}
                            {photoCounts[item.id] ? (
                              <div className="mt-2">
                                <PhotoThumbs photos={photosFor(item.id)} urls={photoUrls} label={`Photos for ${item.prompt}`} />
                              </div>
                            ) : null}
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {photoCounts[item.id] ? (
                              <span className="flex items-center gap-1 text-xs text-muted-foreground" title="Photos attached">
                                <Camera className="size-3.5" aria-hidden />
                                {photoCounts[item.id]}
                              </span>
                            ) : null}
                            {item.response_type === 'YES_NO_NA' ? (
                              r?.answer ? (
                                <StatusBadge status={r.answer} tone={failed ? 'danger' : r.answer === 'N/A' ? 'neutral' : 'success'} />
                              ) : (
                                <span className="text-xs text-muted-foreground">Not answered</span>
                              )
                            ) : (
                              <span className="text-sm font-medium tabular-nums">{value ?? <span className="text-xs text-muted-foreground">Not answered</span>}</span>
                            )}
                            {failed ? <StatusBadge status={item.failure_severity} tone={SEVERITY_TONE[item.failure_severity]} /> : null}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </CardContent>
              )}
            </Card>
          );
        })}

      {raw.overall_comments ? (
        <Card>
          <CardHeader>
            <CardTitle>Overall comments</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{raw.overall_comments}</p>
          </CardContent>
        </Card>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Template v{visit.template_version}. Sections: {sections.map((s) => PM_CATEGORY_LABELS[s.category]).join(' · ')}.
      </p>
    </div>
  );
}

/** GPS evidence recorded when the PM was started (computed by the server). */
function GpsCheckIn({ visit }: { visit: Tables<'pm_visits'> }) {
  const status = visit.gps_status;
  if (!status) return null;
  const tone = status === 'WITHIN_RADIUS' ? 'success' : status === 'SITE_HAS_NO_COORDINATES' ? 'info' : 'warning';
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle>GPS check-in</CardTitle>
        <StatusBadge status={status} tone={tone} />
      </CardHeader>
      <CardContent>
        <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs text-muted-foreground">Position</dt>
            <dd className="font-medium tabular-nums">
              {visit.gps_latitude != null && visit.gps_longitude != null
                ? `${visit.gps_latitude.toFixed(5)}, ${visit.gps_longitude.toFixed(5)}`
                : 'Not captured'}
              {visit.gps_accuracy_m != null ? <span className="text-muted-foreground"> (±{Math.round(visit.gps_accuracy_m)} m)</span> : null}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Distance from site</dt>
            <dd className="font-medium tabular-nums">{formatDistance(visit.gps_distance_m)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Allowed radius · mode</dt>
            <dd className="font-medium">
              {visit.gps_radius_m != null ? `${visit.gps_radius_m} m` : '—'} · {visit.geofence_mode ? humanizeStatus(visit.geofence_mode) : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Captured</dt>
            <dd className="font-medium">{when(visit.gps_captured_at)}</dd>
          </div>
        </dl>
        {visit.outside_radius_reason ? (
          <Alert tone="warning" className="mt-3">
            Technician&apos;s reason for starting outside the site area: {visit.outside_radius_reason}
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}
