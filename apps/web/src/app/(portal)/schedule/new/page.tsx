import { toIsoDate } from '@ipt/shared';
import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { requireCapability } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { ScheduleForm } from './schedule-form';

export const metadata: Metadata = { title: 'Schedule PM' };

export default async function NewSchedulePage({ searchParams }: { searchParams: Promise<{ site?: string }> }) {
  const { site } = await searchParams;
  await requireCapability('schedule_pm');
  const supabase = await createClient();
  const [sites, assignments, templates] = await Promise.all([
    supabase.from('sites').select('id, site_code, site_name').eq('status', 'ACTIVE').order('site_code'),
    supabase
      .from('site_assignments')
      .select('site_id, technician_id, technicians(is_active, profiles!technicians_id_fkey(full_name, email, is_active))')
      .eq('is_active', true),
    supabase.from('pm_templates').select('id, name, version').eq('status', 'ACTIVE').order('name'),
  ]);
  for (const r of [sites, assignments, templates]) if (r.error) throw new Error(`Unable to load form data: ${r.error.message}`);

  const technicians: Record<string, { id: string; name: string }[]> = {};
  for (const a of assignments.data ?? []) {
    const p = a.technicians?.profiles;
    if (!a.technicians?.is_active || !p?.is_active) continue;
    (technicians[a.site_id] ??= []).push({ id: a.technician_id, name: p?.full_name || p?.email || 'Technician' });
  }
  const templateOptions = (templates.data ?? []).map((t) => ({ id: t.id, label: `${t.name} (v${t.version})` }));

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title="Schedule PM" description="Create one PM or a recurring series for a site." />
      {templateOptions.length === 0 ? <Alert tone="warning">No active PM template. Activate one under Admin → PM Templates.</Alert> : null}
      <Card>
        <CardContent className="pt-5">
          <ScheduleForm
            sites={(sites.data ?? []).map((s) => ({ id: s.id, label: `${s.site_code} · ${s.site_name}` }))}
            technicians={technicians}
            templates={templateOptions}
            today={toIsoDate(new Date())}
            initialSiteId={site}
          />
        </CardContent>
      </Card>
    </div>
  );
}
