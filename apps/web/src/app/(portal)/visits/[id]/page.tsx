import { PM_STATUS_TONE } from '@ipt/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { FileText } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { load } from '@/lib/api/data';
import type { PmStatus } from '@/lib/api/types';
import { hasPermission, requirePermission } from '@/lib/auth';
import { formatDate, formatDateTime } from '@/lib/format';
import { ReviewForm } from './review-form';

export const metadata: Metadata = { title: 'PM visit' };

interface Item {
  id: string;
  code: string;
  prompt: string;
  responseType: string;
  unit: string | null;
  isRequired: boolean;
}
interface Field {
  id: string;
  label: string;
  unit: string | null;
}
interface Response {
  checklistItemId: string;
  answer: 'YES' | 'NO' | 'NA' | null;
  numericValue: number | null;
  textValue: string | null;
  selectedOptions: string[] | null;
  dateValue: string | null;
  datetimeValue: string | null;
  comment: string | null;
  isFailure: boolean;
}
type Num = number | null;
interface Visit {
  id: string;
  status: PmStatus;
  startedAt: string;
  completedAt: string | null;
  completionPct: number;
  failureCount: number;
  notApplicableSections: string[];
  overallComments: string | null;
  reviewComments: string | null;
  reviewedAt: string | null;
  reviewedBy: { fullName: string } | null;
  technicianId: string;
  isDemo: boolean;
  gpsStatus: string | null;
  gpsDistanceM: Num;
  gpsRadiusM: Num;
  gpsAccuracyM: Num;
  geofenceMode: string | null;
  outsideRadiusReason: string | null;
  site: { id: string; siteCode: string; siteName: string };
  technician: { fullName: string };
  template: { name: string; version: number };
  schedule: { id: string; dueDate: string } | null;
  sections: { id: string; code: string; name: string; items: Item[]; readingFields: Field[] }[];
  responses: Response[];
  readings: { readingFieldId: string; numericValue: Num; textValue: string | null }[];
  photos: { id: string; checklistItemId: string | null; caption: string | null; createdAt: string }[];
  signature: { signedAt: string; signedName: string | null } | null;
  progress: { sections: { code: string; required: number; done: number; failures: number; notApplicable: boolean }[] };
  issues: { sectionCode: string; kind: string; label: string }[];
  modules: {
    dc: { dcPowerKw: Num; totalPhaseCurrentA: Num; rectifierVoltageV: Num; loadCurrentA: Num } | null;
    battery: { batteryVoltageV: Num; unitsRecorded: number; minUnitVoltageV: Num; maxUnitVoltageV: Num; units: { unitNumber: number; voltageV: number }[] } | null;
    generator: { runningHours: Num; fuelLevelPct: Num; generatorKva: Num; oilPressure: string | null } | null;
  };
}

function answerText(item: Item, r: Response | undefined): string {
  if (!r) return '—';
  if (r.answer === 'NA') return 'N/A';
  if (r.answer) return r.answer === 'YES' ? 'Yes' : 'No';
  if (r.numericValue != null) return `${r.numericValue}${item.unit ? ` ${item.unit}` : ''}`;
  if (r.textValue) return r.textValue;
  if (r.selectedOptions?.length) return r.selectedOptions.join(', ');
  if (r.dateValue) return formatDate(r.dateValue);
  if (r.datetimeValue) return formatDateTime(r.datetimeValue);
  return '—';
}

const GPS_TEXT: Record<string, string> = {
  WITHIN_RADIUS: 'Within the site radius',
  OUTSIDE_RADIUS: 'Outside the site radius',
  UNAVAILABLE: 'Location unavailable',
  SITE_HAS_NO_COORDINATES: 'Site has no coordinates',
};

const DONE: Record<string, string> = { approved: 'PM approved.', returned: 'PM returned to the technician for correction.' };

export default async function VisitPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string }> }) {
  const { id } = await params;
  const { done } = await searchParams;
  const session = await requirePermission('pm_visits.read');
  const v = await load<Visit>(`/visits/${id}`);
  const responses = new Map(v.responses.map((r) => [r.checklistItemId, r]));
  const readings = new Map(v.readings.map((r) => [r.readingFieldId, r]));
  const canReview = v.status === 'COMPLETED' && hasPermission(session, 'pm_visits.review') && v.technicianId !== session.userId;
  const photosOf = (itemId: string | null) => v.photos.filter((p) => p.checklistItemId === itemId);
  const kw = v.modules.dc?.dcPowerKw;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`PM — ${v.site.siteCode} · ${v.site.siteName}`}
        description={`${v.template.name} v${v.template.version} · ${v.technician.fullName}`}
        actions={
          <>
            <StatusBadge status={v.status === 'COMPLETED' ? 'WAITING_FOR_REVIEW' : v.status} tone={PM_STATUS_TONE[v.status]} />
            <a href={`/files/visits/${v.id}/report.pdf`} target="_blank" rel="noopener" className={buttonVariants({ variant: 'outline' })}>
              <FileText aria-hidden />
              PM report (PDF)
            </a>
          </>
        }
      />
      {done && DONE[done] ? <Alert tone="success">{DONE[done]}</Alert> : null}
      {v.isDemo ? <Alert tone="info">Demo data seeded from the Tienii 1301 reference report — not a live PM.</Alert> : null}
      {v.status === 'REJECTED' && v.reviewComments ? <Alert tone="danger">Returned for correction: {v.reviewComments}</Alert> : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Visit</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Started</dt>
              <dd>{formatDateTime(v.startedAt)}</dd>
              <dt className="text-muted-foreground">Completed</dt>
              <dd>{formatDateTime(v.completedAt)}</dd>
              <dt className="text-muted-foreground">Completion</dt>
              <dd>{Math.floor(v.completionPct)}%</dd>
              <dt className="text-muted-foreground">Failures</dt>
              <dd>
                {v.failureCount ? (
                  <Link href={`/failures?visit=${v.id}`} className="text-danger hover:underline">
                    {v.failureCount} recorded
                  </Link>
                ) : (
                  'None'
                )}
              </dd>
              {v.schedule ? (
                <>
                  <dt className="text-muted-foreground">Scheduled PM</dt>
                  <dd>
                    <Link href={`/schedule/${v.schedule.id}`} className="hover:underline">
                      Due {formatDate(v.schedule.dueDate)}
                    </Link>
                  </dd>
                </>
              ) : null}
              {v.reviewedAt ? (
                <>
                  <dt className="text-muted-foreground">Reviewed</dt>
                  <dd>
                    {formatDateTime(v.reviewedAt)} by {v.reviewedBy?.fullName ?? '—'}
                  </dd>
                </>
              ) : null}
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Location at start</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <Badge tone={v.gpsStatus === 'WITHIN_RADIUS' ? 'success' : v.gpsStatus === 'OUTSIDE_RADIUS' ? 'warning' : 'neutral'}>{GPS_TEXT[v.gpsStatus ?? ''] ?? 'Not recorded'}</Badge>
            </p>
            {v.gpsDistanceM != null ? (
              <p>
                {Math.round(v.gpsDistanceM)} m from the site (allowed {v.gpsRadiusM} m{v.gpsAccuracyM != null ? `, GPS ±${Math.round(v.gpsAccuracyM)} m` : ''})
              </p>
            ) : null}
            {v.geofenceMode ? <p className="text-muted-foreground">Rule at the time: {v.geofenceMode.replace('_', ' ').toLowerCase()}</p> : null}
            {v.outsideRadiusReason ? <p>Reason given: {v.outsideRadiusReason}</p> : null}
            <p className="text-xs text-muted-foreground">The position is as reported by the phone.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Technician signature</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {v.signature ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element -- server-drawn SVG relayed from the API */}
                <img src={`/files/visits/${v.id}/signature`} alt={`Signature of ${v.signature.signedName ?? v.technician.fullName}`} className="h-24 w-full rounded border bg-white object-contain" />
                <p className="text-muted-foreground">
                  {v.signature.signedName ?? '—'}, {formatDateTime(v.signature.signedAt)}
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">Not signed.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {v.modules.dc || v.modules.battery || v.modules.generator ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Power summary</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm md:grid-cols-3">
            {v.modules.generator ? (
              <div>
                <p className="font-medium">Generator</p>
                <p>Running hours: {v.modules.generator.runningHours ?? '—'}</p>
                <p>Fuel: {v.modules.generator.fuelLevelPct != null ? `${v.modules.generator.fuelLevelPct}%` : '—'}</p>
                <p>KVA: {v.modules.generator.generatorKva ?? '—'}</p>
                <p>Oil pressure: {v.modules.generator.oilPressure ?? '—'}</p>
              </div>
            ) : null}
            {v.modules.dc ? (
              <div>
                <p className="font-medium">DC system</p>
                <p>Rectifier voltage: {v.modules.dc.rectifierVoltageV ?? '—'} V</p>
                <p>Load current: {v.modules.dc.loadCurrentA ?? '—'} A</p>
                <p>DC power: {kw != null ? `${kw} kW (calculated V × A)` : '—'}</p>
              </div>
            ) : null}
            {v.modules.battery ? (
              <div>
                <p className="font-medium">Battery</p>
                <p>Bank voltage: {v.modules.battery.batteryVoltageV ?? '—'} V</p>
                {v.modules.battery.unitsRecorded ? (
                  <p>
                    {v.modules.battery.unitsRecorded} batteries: {v.modules.battery.minUnitVoltageV}–{v.modules.battery.maxUnitVoltageV} V
                  </p>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {canReview ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Review</CardTitle>
          </CardHeader>
          <CardContent>
            <ReviewForm visitId={v.id} />
          </CardContent>
        </Card>
      ) : null}

      {v.overallComments ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Technician&apos;s comments</CardTitle>
          </CardHeader>
          <CardContent className="whitespace-pre-wrap text-sm">{v.overallComments}</CardContent>
        </Card>
      ) : null}

      {v.sections.map((s) => {
        const na = v.notApplicableSections.includes(s.code);
        const p = v.progress.sections.find((x) => x.code === s.code);
        return (
          <Card key={s.id}>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-base">{s.name}</CardTitle>
              {na ? <Badge tone="neutral">Not applicable</Badge> : <span className="text-sm text-muted-foreground">{p ? `${p.done} of ${p.required} required` : ''}{p?.failures ? ` · ${p.failures} failure${p.failures === 1 ? '' : 's'}` : ''}</span>}
            </CardHeader>
            {na ? null : (
              <CardContent className="space-y-4">
                {s.readingFields.length ? (
                  <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
                    {s.readingFields.map((f) => {
                      const r = readings.get(f.id);
                      const value = r?.numericValue ?? r?.textValue;
                      return (
                        <div key={f.id} className="flex justify-between gap-2 border-b py-1">
                          <dt className="text-muted-foreground">{f.label}</dt>
                          <dd className="font-medium tabular-nums">{value == null ? '—' : `${value}${f.unit && r?.numericValue != null ? ` ${f.unit}` : ''}`}</dd>
                        </div>
                      );
                    })}
                  </dl>
                ) : null}
                <ul className="divide-y text-sm">
                  {s.items.map((i) => {
                    const r = responses.get(i.id);
                    const photos = photosOf(i.id);
                    return (
                      <li key={i.id} className="space-y-1 py-2">
                        <div className="flex items-start justify-between gap-3">
                          <span>{i.prompt}</span>
                          <span className="flex shrink-0 items-center gap-2">
                            {r?.isFailure ? <Badge tone="danger">Failure</Badge> : null}
                            <span className="font-medium">{answerText(i, r)}</span>
                          </span>
                        </div>
                        {r?.comment ? <p className="text-muted-foreground">Comment: {r.comment}</p> : null}
                        {photos.length ? (
                          <div className="flex flex-wrap gap-2">
                            {photos.map((ph) => (
                              <a key={ph.id} href={`/files/visits/${v.id}/photos/${ph.id}`} target="_blank" rel="noreferrer">
                                {/* eslint-disable-next-line @next/next/no-img-element -- photos relayed from the API */}
                                <img src={`/files/visits/${v.id}/photos/${ph.id}`} alt={ph.caption ?? `Photo for ${i.prompt}`} className="size-24 rounded border object-cover" loading="lazy" />
                              </a>
                            ))}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            )}
          </Card>
        );
      })}

      {photosOf(null).length ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Other photos</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {photosOf(null).map((ph) => (
              <a key={ph.id} href={`/files/visits/${v.id}/photos/${ph.id}`} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element -- photos relayed from the API */}
                <img src={`/files/visits/${v.id}/photos/${ph.id}`} alt={ph.caption ?? 'Visit photo'} className="size-24 rounded border object-cover" loading="lazy" />
              </a>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
