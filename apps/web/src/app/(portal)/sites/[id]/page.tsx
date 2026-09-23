import {
  can,
  CORRECTIVE_ACTION_STATUS_TONE,
  FAILURE_STATUS_TONE,
  PM_CATEGORY_LABELS,
  PM_STATUS_TONE,
  SEVERITY_TONE,
  toIsoDate,
} from '@ipt/shared';
import { ExternalLink, Pencil } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { LatestReadings } from '@/components/latest-readings';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { endAssignment } from '../actions';
import { AssignForm } from './assign-form';

export const metadata: Metadata = { title: 'Site' };

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{children ?? '—'}</dd>
    </div>
  );
}

function unwrap<T>(label: string, r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(`Unable to load ${label}: ${r.error.message}`);
  return r.data as T;
}

const date = (v: string | null) => (v ? new Date(v).toLocaleDateString('en-GB') : '—');

export default async function SitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const supabase = await createClient();
  const today = toIsoDate(new Date());

  const siteResult = await supabase.from('site_overview').select('*').eq('id', id).maybeSingle();
  const site = unwrap('site', siteResult);
  if (!site) notFound();

  const [assignments, schedules, visits, failures, actions, technicians, settings] = await Promise.all([
    supabase
      .from('site_assignments')
      .select('id, starts_on, ends_on, technician_id, technicians(is_active, profiles!technicians_id_fkey(full_name, email, is_active))')
      .eq('site_id', id)
      .eq('is_active', true)
      .order('starts_on'),
    supabase
      .from('pm_schedules')
      .select('id, scheduled_date, due_date, status, frequency, priority')
      .eq('site_id', id)
      .in('status', ['SCHEDULED', 'IN_PROGRESS', 'OVERDUE', 'REJECTED'])
      .order('due_date')
      .limit(5),
    supabase
      .from('pm_visits')
      .select('id, status, started_at, submitted_at, completion_pct, failure_count, is_demo')
      .eq('site_id', id)
      .order('started_at', { ascending: false, nullsFirst: false })
      .limit(10),
    supabase
      .from('failures')
      .select('id, failure_number, category, description, severity, status, detected_at')
      .eq('site_id', id)
      .not('status', 'in', '("VERIFIED","CLOSED")')
      .order('detected_at', { ascending: false })
      .limit(10),
    supabase
      .from('corrective_actions')
      .select('id, action_number, category, description, priority, status, due_date')
      .eq('site_id', id)
      .neq('status', 'CLOSED')
      .order('due_date', { nullsFirst: false })
      .limit(10),
    can(session.role, 'manage_assignments')
      ? supabase.from('technician_overview').select('id, full_name, email, region_name').eq('is_active', true).order('full_name')
      : Promise.resolve({ data: [], error: null }),
    supabase.from('system_settings').select('value').eq('key', 'geofence').maybeSingle(),
  ]);

  const assigned = unwrap('assignments', assignments);
  const canManage = can(session.role, 'manage_assignments');
  const assignedIds = new Set(assigned.map((a) => a.technician_id));
  const techOptions = unwrap('technicians', technicians)
    .filter((t) => t.id && !assignedIds.has(t.id))
    .map((t) => ({ id: t.id!, label: `${t.full_name || t.email}${t.region_name ? ` · ${t.region_name}` : ''}` }));
  const defaultRadius = (unwrap('settings', settings)?.value as { radius_m?: number } | null)?.radius_m;
  const power = [
    site.generator_available && 'Generator',
    site.battery_available && 'Battery',
    site.solar_available && 'Solar',
    site.grid_available && 'Grid',
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${site.site_code} · ${site.site_name}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={site.status === 'ACTIVE' ? 'success' : 'neutral'}>{site.status}</Badge>
            {site.is_demo ? <Badge tone="neutral">Demo data</Badge> : null}
            <span>{[site.region_name, site.cluster_name, site.county_name].filter(Boolean).join(' › ')}</span>
          </span>
        }
        actions={
          can(session.role, 'manage_organization') ? (
            <Link href={`/sites/${id}/edit`} className={buttonVariants({ variant: 'outline' })}>
              <Pencil aria-hidden />
              Edit site
            </Link>
          ) : null
        }
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Overview</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4">
              <Field label="Region">{site.region_name}</Field>
              <Field label="Cluster">{site.cluster_name}</Field>
              <Field label="County">{site.county_name}</Field>
              <Field label="Supervisor">{site.supervisor_name}</Field>
              <Field label="Site type">{site.site_type}</Field>
              <Field label="Last PM">{date(site.last_pm_at)}</Field>
              <Field label="Next PM due">{date(site.next_pm_due)}</Field>
              <Field label="Open failures / actions">
                {site.open_failures ?? 0} / {site.open_corrective_actions ?? 0}
              </Field>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Location</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4">
              <Field label="Latitude">{site.latitude}</Field>
              <Field label="Longitude">{site.longitude}</Field>
              <Field label="Geofence radius">
                {site.geofence_radius_m ?? defaultRadius ?? '—'} m{site.geofence_radius_m == null && defaultRadius ? ' (default)' : ''}
              </Field>
              <Field label="Address">{site.address}</Field>
            </dl>
            {site.latitude != null && site.longitude != null ? (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${site.latitude},${site.longitude}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex items-center gap-1 text-sm text-info hover:underline"
              >
                Open in maps <ExternalLink className="size-3.5" aria-hidden />
              </a>
            ) : (
              <p className="mt-4 text-sm text-warning">
                No coordinates recorded — GPS check-in cannot verify technician location for this site.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Power configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {power.length ? power.map((p) => <Badge key={p} tone="info">{p}</Badge>) : <span className="text-sm text-muted-foreground">Not recorded</span>}
            </div>
            {site.power_configuration ? <p className="text-sm">{site.power_configuration}</p> : null}
          </CardContent>
        </Card>
      </div>

      <LatestReadings supabase={supabase} siteId={id} />

      <Card>
        <CardHeader>
          <CardTitle>Assigned technicians</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {assigned.length === 0 ? (
            <p className="text-sm text-muted-foreground">No technician is assigned to this site.</p>
          ) : (
            <ul className="divide-y">
              {assigned.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span>
                    <span className="font-medium">{a.technicians?.profiles?.full_name || a.technicians?.profiles?.email || 'Technician'}</span>
                    <span className="ml-2 text-muted-foreground">since {date(a.starts_on)}</span>
                    {a.ends_on ? <span className="ml-2 text-muted-foreground">until {date(a.ends_on)}</span> : null}
                    {a.technicians && (!a.technicians.is_active || !a.technicians.profiles?.is_active) ? (
                      <Badge tone="warning" className="ml-2">
                        Inactive account
                      </Badge>
                    ) : null}
                  </span>
                  {canManage ? (
                    <form action={endAssignment}>
                      <input type="hidden" name="assignment_id" value={a.id} />
                      <input type="hidden" name="site_id" value={id} />
                      <Button type="submit" variant="ghost" size="sm">
                        End assignment
                      </Button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {canManage ? <AssignForm siteId={id} technicians={techOptions} today={today} /> : null}
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Upcoming PM</CardTitle>
          </CardHeader>
          <CardContent>
            {unwrap('schedules', schedules).length === 0 ? (
              <p className="text-sm text-muted-foreground">No open PM schedule.</p>
            ) : (
              <ul className="divide-y text-sm">
                {unwrap('schedules', schedules).map((s) => {
                  const overdue = s.status === 'OVERDUE' || s.due_date < today;
                  return (
                    <li key={s.id} className="flex items-center justify-between py-2">
                      <span>
                        Due {date(s.due_date)} · {s.frequency.toLowerCase()}
                      </span>
                      <StatusBadge status={overdue ? 'OVERDUE' : s.status} tone={overdue ? 'danger' : PM_STATUS_TONE[s.status]} />
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>PM history</CardTitle>
          </CardHeader>
          <CardContent>
            {unwrap('visits', visits).length === 0 ? (
              <p className="text-sm text-muted-foreground">No PM visits recorded yet.</p>
            ) : (
              <ul className="divide-y text-sm">
                {unwrap('visits', visits).map((v) => (
                  <li key={v.id} className="flex items-center justify-between py-2">
                    <span>
                      {date(v.started_at)} · {v.completion_pct}% · {v.failure_count} failure(s)
                      {v.is_demo ? ' · demo' : ''}
                    </span>
                    <StatusBadge status={v.status} tone={PM_STATUS_TONE[v.status]} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Open failures</CardTitle>
          </CardHeader>
          <CardContent>
            {unwrap('failures', failures).length === 0 ? (
              <p className="text-sm text-muted-foreground">No open failures.</p>
            ) : (
              <ul className="divide-y text-sm">
                {unwrap('failures', failures).map((f) => (
                  <li key={f.id} className="flex items-start justify-between gap-3 py-2">
                    <span>
                      <span className="font-medium">{f.failure_number}</span> · {PM_CATEGORY_LABELS[f.category]} ·{' '}
                      {f.description}
                    </span>
                    <span className="flex shrink-0 gap-1">
                      <StatusBadge status={f.severity} tone={SEVERITY_TONE[f.severity]} />
                      <StatusBadge status={f.status} tone={FAILURE_STATUS_TONE[f.status]} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Corrective actions</CardTitle>
          </CardHeader>
          <CardContent>
            {unwrap('corrective actions', actions).length === 0 ? (
              <p className="text-sm text-muted-foreground">No open corrective actions.</p>
            ) : (
              <ul className="divide-y text-sm">
                {unwrap('corrective actions', actions).map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-3 py-2">
                    <span>
                      <span className="font-medium">{a.action_number}</span> · {a.description}
                      {a.due_date ? <span className="text-muted-foreground"> · due {date(a.due_date)}</span> : null}
                    </span>
                    <StatusBadge status={a.status} tone={CORRECTIVE_ACTION_STATUS_TONE[a.status]} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
