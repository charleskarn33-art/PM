import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { load, loadAll } from '@/lib/api/data';
import type { Site, UserSummary } from '@/lib/api/types';
import { hasPermission, requirePermission } from '@/lib/auth';
import { NewScheduleForm } from '../schedule-forms';

export const metadata: Metadata = { title: 'Schedule PM' };

export default async function NewSchedulePage({ searchParams }: { searchParams: Promise<{ site?: string }> }) {
  const { site } = await searchParams;
  const session = await requirePermission('pm_schedules.manage');
  const [sites, technicians, templates] = await Promise.all([
    loadAll<Site>('/sites?status=ACTIVE'),
    hasPermission(session, 'users.read') ? loadAll<UserSummary>('/users?role=TECHNICIAN&active=true') : Promise.resolve([] as UserSummary[]),
    load<{ code: string; name: string; version: number; status: string }[]>('/pm-templates'),
  ]);
  // Schedules are planned in the supervisor's regions.
  const managed = sites.filter((s) => session.isGlobal || session.regionIds.includes(s.regionId));
  const active = templates.filter((t) => t.status === 'ACTIVE');
  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title="Schedule PM" description="Plan a PM (or a recurring series) for a site in your regions." />
      <Card>
        <CardContent className="pt-6">
          <NewScheduleForm
            siteId={site}
            sites={managed.map((s) => ({ id: s.id, label: `${s.siteCode} · ${s.siteName}` }))}
            technicians={technicians.map((t) => ({ id: t.id, label: t.fullName }))}
            templates={active.map((t) => ({ code: t.code, label: `${t.name} (v${t.version})` }))}
            today={new Date().toISOString().slice(0, 10)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
