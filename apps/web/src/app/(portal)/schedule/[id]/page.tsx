import { can, humanizeStatus, PM_STATUS_TONE } from '@ipt/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireRole } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { cancelSchedule } from '../actions';
import { EditScheduleForm } from './edit-form';

export const metadata: Metadata = { title: 'PM schedule' };
const date = (v: string | null) => (v ? new Date(v).toLocaleDateString('en-GB') : '—');

export default async function ScheduleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireRole(['super_admin', 'regional_manager', 'regional_supervisor', 'viewer']);
  const supabase = await createClient();
  const { data: s, error } = await supabase.from('pm_schedule_overview').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`Unable to load schedule: ${error.message}`);
  if (!s || !s.site_id) notFound();

  const assignments = await supabase
    .from('site_assignments')
    .select('technician_id, technicians(is_active, profiles!technicians_id_fkey(full_name, email, is_active))')
    .eq('site_id', s.site_id)
    .eq('is_active', true);
  if (assignments.error) throw new Error(assignments.error.message);
  const technicians = (assignments.data ?? [])
    .filter((a) => a.technicians?.is_active && a.technicians.profiles?.is_active)
    .map((a) => ({
    id: a.technician_id,
    name: a.technicians?.profiles?.full_name || a.technicians?.profiles?.email || 'Technician',
  }));
  const editable = can(session.role, 'schedule_pm') && ['SCHEDULED', 'OVERDUE'].includes(s.status ?? '');

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title={`${s.site_code} · ${s.site_name}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            PM due {date(s.due_date)}
            <StatusBadge status={s.status!} tone={PM_STATUS_TONE[s.status!]} />
            {s.is_overdue && s.status !== 'OVERDUE' ? <StatusBadge status="OVERDUE" tone="danger" /> : null}
          </span>
        }
        actions={
          <>
            {s.visit_id ? (
              <Link href={`/visits/${s.visit_id}`} className={buttonVariants({ variant: 'outline' })}>
                Open PM visit
              </Link>
            ) : null}
            <Link href={`/sites/${s.site_id}`} className={buttonVariants({ variant: 'ghost' })}>
              Site
            </Link>
          </>
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 text-sm sm:grid-cols-3">
            <div><dt className="text-muted-foreground">Technician</dt><dd className="font-medium">{s.technician_name ?? 'Unassigned'}</dd></div>
            <div><dt className="text-muted-foreground">Supervisor</dt><dd className="font-medium">{s.supervisor_name ?? '—'}</dd></div>
            <div><dt className="text-muted-foreground">Frequency</dt><dd className="font-medium">{humanizeStatus(s.frequency ?? '')}</dd></div>
            <div><dt className="text-muted-foreground">Scheduled</dt><dd className="font-medium">{date(s.scheduled_date)}</dd></div>
            <div><dt className="text-muted-foreground">Due</dt><dd className="font-medium">{date(s.due_date)}</dd></div>
            <div><dt className="text-muted-foreground">Template</dt><dd className="font-medium">{s.template_name} v{s.template_version}</dd></div>
          </dl>
          {s.notes ? <p className="mt-4 text-sm">{s.notes}</p> : null}
        </CardContent>
      </Card>
      {editable ? (
        <Card>
          <CardHeader>
            <CardTitle>Reschedule or reassign</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <EditScheduleForm
              schedule={{
                id: s.id!,
                scheduled_date: s.scheduled_date!,
                due_date: s.due_date!,
                technician_id: s.technician_id,
                priority: s.priority ?? 'MEDIUM',
                notes: s.notes,
              }}
              technicians={technicians}
            />
            <form action={cancelSchedule} className="border-t pt-4">
              <input type="hidden" name="id" value={s.id!} />
              <Button type="submit" variant="destructive" size="sm">
                Cancel this PM
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
