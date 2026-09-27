import { humanizeStatus, PM_STATUS_TONE } from '@ipt/shared';
import { Plus, Search } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ColumnToggle } from '@/components/data-table/column-toggle';
import { Pagination } from '@/components/data-table/pagination';
import { SortHeader } from '@/components/data-table/sort-header';
import { EmptyRow } from '@/components/empty-row';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { load, loadAll, loadPage, qs } from '@/lib/api/data';
import type { Region, Site, UserSummary } from '@/lib/api/types';
import { hasPermission, requirePermission } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { parseTableParams, type SearchParams } from '@/lib/table-params';

export const metadata: Metadata = { title: 'Sites' };

const COLUMNS = [
  { key: 'region', label: 'Region' },
  { key: 'cluster', label: 'Cluster' },
  { key: 'county', label: 'County' },
  { key: 'technician', label: 'Technician' },
  { key: 'supervisor', label: 'Supervisor' },
  { key: 'pm', label: 'Next PM' },
  { key: 'last', label: 'Last PM' },
  { key: 'failures', label: 'Open failures' },
  { key: 'actions', label: 'Open actions' },
  { key: 'status', label: 'Site status' },
];

export default async function SitesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const session = await requirePermission('sites.read');
  const params = parseTableParams(sp, {
    sortable: ['siteCode', 'siteName', 'region', 'status'] as const,
    defaultSort: 'siteCode',
    filters: ['region', 'cluster', 'county', 'supervisor', 'pm', 'status'],
  });
  const f = params.filters;
  const [page, hierarchy, supervisors] = await Promise.all([
    loadPage<Site>(
      `/sites${qs({ q: params.q, regionId: f.region, clusterId: f.cluster, countyId: f.county, supervisorId: f.supervisor, pm: f.pm, status: f.status, sort: params.sort, dir: params.dir, page: params.page, pageSize: params.pageSize })}`,
    ),
    hasPermission(session, 'org.read') ? load<Region[]>('/org/hierarchy') : Promise.resolve([] as Region[]),
    hasPermission(session, 'users.read') ? loadAll<UserSummary>('/users?role=REGIONAL_SUPERVISOR&active=true') : Promise.resolve([] as UserSummary[]),
  ]);
  const clusters = hierarchy.flatMap((r) => r.clusters).filter((c) => !f.region || c.regionId === f.region);
  const counties = clusters.flatMap((c) => c.counties).filter((c) => !f.cluster || c.clusterId === f.cluster);
  const show = (key: string) => !params.hidden.has(key);
  const sortProps = { pathname: '/sites', searchParams: sp, sort: params.sort, dir: params.dir };
  const colSpan = 2 + COLUMNS.filter((c) => show(c.key)).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sites"
        description="Telecom power sites in your scope."
        actions={
          hasPermission(session, 'sites.manage') && session.isGlobal ? (
            <Link href="/sites/new" className={buttonVariants({ variant: 'accent' })}>
              <Plus aria-hidden />
              New site
            </Link>
          ) : null
        }
      />

      <form method="get" className="grid gap-3 rounded-xl border bg-card p-4 md:grid-cols-3 xl:grid-cols-7" role="search">
        <div className="relative md:col-span-3 xl:col-span-2">
          <Search className="absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden />
          <Input name="q" defaultValue={params.q} placeholder="Site ID, name or county" className="pl-9" aria-label="Search sites" />
        </div>
        {hierarchy.length ? (
          <>
            <Select name="region" defaultValue={f.region ?? ''} aria-label="Region">
              <option value="">All regions</option>
              {hierarchy.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
            <Select name="cluster" defaultValue={f.cluster ?? ''} aria-label="Cluster">
              <option value="">All clusters</option>
              {clusters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Select name="county" defaultValue={f.county ?? ''} aria-label="County">
              <option value="">All counties</option>
              {counties.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </>
        ) : null}
        {supervisors.length ? (
          <Select name="supervisor" defaultValue={f.supervisor ?? ''} aria-label="Supervisor">
            <option value="">All supervisors</option>
            {supervisors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.fullName}
              </option>
            ))}
          </Select>
        ) : null}
        <Select name="pm" defaultValue={f.pm ?? ''} aria-label="PM status">
          <option value="">Any PM status</option>
          <option value="overdue">Overdue</option>
          <option value="scheduled">Scheduled</option>
          <option value="none">Not scheduled</option>
        </Select>
        <Select name="status" defaultValue={f.status ?? ''} aria-label="Site status">
          <option value="">Any site status</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
          <option value="DECOMMISSIONED">Decommissioned</option>
        </Select>
        <input type="hidden" name="sort" value={params.sort} />
        <input type="hidden" name="dir" value={params.dir} />
        {params.hidden.size ? <input type="hidden" name="hide" value={[...params.hidden].join(',')} /> : null}
        <div className="flex items-center justify-between gap-2 md:col-span-3 xl:col-span-7">
          <div className="flex gap-2">
            <Button type="submit">Apply</Button>
            <Link href="/sites" className={buttonVariants({ variant: 'ghost' })}>
              Reset
            </Link>
          </div>
          <ColumnToggle columns={COLUMNS} />
        </div>
      </form>

      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <SortHeader label="Site ID" column="siteCode" {...sortProps} />
            <SortHeader label="Site name" column="siteName" {...sortProps} />
            {show('region') ? <SortHeader label="Region" column="region" {...sortProps} /> : null}
            {show('cluster') ? <TableHead>Cluster</TableHead> : null}
            {show('county') ? <TableHead>County</TableHead> : null}
            {show('technician') ? <TableHead>Technician</TableHead> : null}
            {show('supervisor') ? <TableHead>Supervisor</TableHead> : null}
            {show('pm') ? <TableHead>Next PM</TableHead> : null}
            {show('last') ? <TableHead>Last PM</TableHead> : null}
            {show('failures') ? <TableHead>Failures</TableHead> : null}
            {show('actions') ? <TableHead>Actions</TableHead> : null}
            {show('status') ? <SortHeader label="Status" column="status" {...sortProps} /> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {page.items.length === 0 ? (
            <EmptyRow colSpan={colSpan} message="No sites match these filters." />
          ) : (
            page.items.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="whitespace-nowrap font-medium">
                  <Link href={`/sites/${s.id}`} className="hover:underline">
                    {s.siteCode}
                  </Link>
                </TableCell>
                <TableCell>
                  <Link href={`/sites/${s.id}`} className="hover:underline">
                    {s.siteName}
                  </Link>
                  {s.isDemo ? (
                    <Badge tone="neutral" className="ml-2">
                      Demo
                    </Badge>
                  ) : null}
                </TableCell>
                {show('region') ? <TableCell>{s.region?.name ?? '—'}</TableCell> : null}
                {show('cluster') ? <TableCell>{s.cluster?.name ?? '—'}</TableCell> : null}
                {show('county') ? <TableCell>{s.county?.name ?? '—'}</TableCell> : null}
                {show('technician') ? <TableCell>{s.overview.technicians.map((t) => t.fullName).join(', ') || '—'}</TableCell> : null}
                {show('supervisor') ? <TableCell>{s.overview.supervisor?.fullName ?? '—'}</TableCell> : null}
                {show('pm') ? (
                  <TableCell className="whitespace-nowrap">
                    {s.overview.nextPm ? (
                      <span className="flex items-center gap-2">
                        <StatusBadge status={s.overview.nextPm.status} tone={PM_STATUS_TONE[s.overview.nextPm.status]} />
                        {formatDate(s.overview.nextPm.dueDate)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Not scheduled</span>
                    )}
                  </TableCell>
                ) : null}
                {show('last') ? <TableCell className="whitespace-nowrap">{formatDate(s.overview.lastPmAt)}</TableCell> : null}
                {show('failures') ? (
                  <TableCell>
                    <Badge tone={s.overview.openFailures ? 'danger' : 'neutral'}>{s.overview.openFailures}</Badge>
                  </TableCell>
                ) : null}
                {show('actions') ? (
                  <TableCell>
                    <Badge tone={s.overview.openActions ? 'warning' : 'neutral'}>{s.overview.openActions}</Badge>
                  </TableCell>
                ) : null}
                {show('status') ? (
                  <TableCell>
                    <Badge tone={s.status === 'ACTIVE' ? 'success' : 'neutral'}>{humanizeStatus(s.status)}</Badge>
                  </TableCell>
                ) : null}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <Pagination pathname="/sites" searchParams={sp} page={params.page} pageSize={params.pageSize} total={page.total} />
    </div>
  );
}
