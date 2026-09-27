import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { load, loadPage, qs } from '@/lib/api/data';
import type { Region } from '@/lib/api/types';
import { hasPermission, requirePermission } from '@/lib/auth';
import { parseTableParams, type SearchParams } from '@/lib/table-params';
import { PeopleTable, type PersonRow } from '../people-table';

export const metadata: Metadata = { title: 'Supervisors' };

interface Workload {
  supervisedSites: number;
  sitesInRegions: number;
  awaitingReview: number;
  openFailures: number;
  actionsToVerify: number;
}

export default async function SupervisorsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const session = await requirePermission('users.read');
  const p = parseTableParams(sp, { sortable: ['name'] as const, defaultSort: 'name', filters: ['region'] });
  const [page, regions] = await Promise.all([
    loadPage<PersonRow<Workload>>(`/people${qs({ role: 'REGIONAL_SUPERVISOR', q: p.q, regionId: p.filters.region, page: p.page, pageSize: p.pageSize })}`),
    hasPermission(session, 'org.read') ? load<Region[]>('/org/hierarchy') : Promise.resolve([] as Region[]),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader title="Supervisors" description="Regional supervisors, their regions and what waits for them (their regions plus the sites they supervise)." />
      <PeopleTable
        pathname="/supervisors"
        sp={sp}
        page={page}
        params={{ q: p.q, region: p.filters.region ?? '', page: p.page, pageSize: p.pageSize }}
        regions={regions}
        profileLink={hasPermission(session, 'users.manage')}
        columns={[
          { label: 'Supervised sites', value: (w) => w.supervisedSites },
          { label: 'Sites in regions', value: (w) => w.sitesInRegions },
          { label: 'PMs to review', value: (w) => w.awaitingReview, alert: true },
          { label: 'Open failures', value: (w) => w.openFailures },
          { label: 'Actions to verify', value: (w) => w.actionsToVerify, alert: true },
        ]}
      />
    </div>
  );
}
