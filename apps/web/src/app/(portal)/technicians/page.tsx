import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { load, loadPage, qs } from '@/lib/api/data';
import type { Region } from '@/lib/api/types';
import { hasPermission, requirePermission } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { parseTableParams, type SearchParams } from '@/lib/table-params';
import { PeopleTable, type PersonRow } from '../people-table';

export const metadata: Metadata = { title: 'Technicians' };

interface Workload {
  assignedSites: number;
  openPms: number;
  overduePms: number;
  completedLast30Days: number;
  lastVisitAt: string | null;
  openActions: number;
  overdueActions: number;
}

export default async function TechniciansPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const session = await requirePermission('users.read');
  const p = parseTableParams(sp, { sortable: ['name'] as const, defaultSort: 'name', filters: ['region'] });
  const [page, regions] = await Promise.all([
    loadPage<PersonRow<Workload>>(`/people${qs({ role: 'TECHNICIAN', q: p.q, regionId: p.filters.region, page: p.page, pageSize: p.pageSize })}`),
    hasPermission(session, 'org.read') ? load<Region[]>('/org/hierarchy') : Promise.resolve([] as Region[]),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader title="Technicians" description="Technicians in your scope and their current PM and corrective-action workload." />
      <PeopleTable
        pathname="/technicians"
        sp={sp}
        page={page}
        params={{ q: p.q, region: p.filters.region ?? '', page: p.page, pageSize: p.pageSize }}
        regions={regions}
        profileLink={hasPermission(session, 'users.manage')}
        columns={[
          { label: 'Sites', value: (w) => w.assignedSites },
          { label: 'Open PMs', value: (w) => w.openPms },
          { label: 'Overdue PMs', value: (w) => w.overduePms, alert: true },
          { label: 'PMs done (30 days)', value: (w) => w.completedLast30Days },
          { label: 'Last PM', value: (w) => formatDate(w.lastVisitAt) },
          { label: 'Open actions', value: (w) => w.openActions },
          { label: 'Overdue actions', value: (w) => w.overdueActions, alert: true },
        ]}
      />
    </div>
  );
}
