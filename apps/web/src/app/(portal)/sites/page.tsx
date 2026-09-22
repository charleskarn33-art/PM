import { can, humanizeStatus, PM_STATUS_TONE, toIsoDate } from '@ipt/shared';
import { Download, Plus, Search } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyRow } from '@/components/empty-row';
import { ColumnToggle } from '@/components/data-table/column-toggle';
import { Pagination } from '@/components/data-table/pagination';
import { SortHeader } from '@/components/data-table/sort-header';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireSession } from '@/lib/auth';
import { loadClusters, loadCounties, loadRegions, loadSupervisors } from '@/lib/org-data';
import { parseSiteParams, siteQuery, type SiteOverview } from '@/lib/sites';
import { createClient } from '@/lib/supabase/server';
import type { SearchParams } from '@/lib/table-params';

export const metadata: Metadata = { title: 'Sites' };

const COLUMNS = [
  { key: 'region', label: 'Region' },
  { key: 'cluster', label: 'Cluster' },
  { key: 'county', label: 'County' },
  { key: 'technician', label: 'Technician' },
  { key: 'supervisor', label: 'Supervisor' },
  { key: 'pm', label: 'PM Status' },
  { key: 'last', label: 'Last PM' },
  { key: 'next', label: 'Next PM' },
  { key: 'failures', label: 'Failures' },
  { key: 'actions', label: 'Corrective Actions' },
  { key: 'status', label: 'Site Status' },
];

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString('en-GB') : '—';
}

function pmStatus(site: SiteOverview, today: string) {
  if (!site.next_pm_due || !site.next_pm_status) return <span className="text-muted-foreground">Not scheduled</span>;
  const overdue = site.next_pm_status === 'OVERDUE' || site.next_pm_due < today;
  return overdue ? (
    <StatusBadge status="OVERDUE" tone="danger" />
  ) : (
    <StatusBadge status={site.next_pm_status} tone={PM_STATUS_TONE[site.next_pm_status]} />
  );
}

export default async function SitesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const session = await requireSession();
  const supabase = await createClient();
  const params = parseSiteParams(sp);
  const today = toIsoDate(new Date());

  const [{ data, count, error }, regions, clusters, counties, supervisors] = await Promise.all([
    siteQuery(supabase, params, today, { paginate: true }),
    loadRegions(supabase),
    loadClusters(supabase),
    loadCounties(supabase),
    loadSupervisors(supabase),
  ]);
  if (error) throw new Error(`Unable to load sites: ${error.message}`);
  const sites = data ?? [];
  const show = (key: string) => !params.hidden.has(key);
  const f = params.filters;
  const sortProps = { pathname: '/sites', searchParams: sp, sort: params.sort, dir: params.dir };
  const exportQs = new URLSearchParams(
    Object.entries(sp).flatMap(([k, v]) => (typeof v === 'string' && v ? [[k, v]] : [])),
  ).toString();
  const visibleColumns = 3 + COLUMNS.filter((c) => show(c.key)).length - 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sites"
        description="Telecom power sites in your scope."
        actions={
          <>
            <a href={`/sites/export${exportQs ? `?${exportQs}` : ''}`} className={buttonVariants({ variant: 'outline' })}>
              <Download aria-hidden />
              Export CSV
            </a>
            {can(session.role, 'manage_organization') ? (
              <Link href="/sites/new" className={buttonVariants({ variant: 'accent' })}>
                <Plus aria-hidden />
                New site
              </Link>
            ) : null}
          </>
        }
      />

      <form method="get" className="grid gap-3 rounded-xl border bg-card p-4 md:grid-cols-3 xl:grid-cols-7" role="search">
        <div className="relative md:col-span-3 xl:col-span-2">
          <Search className="absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden />
          <Input
            name="q"
            defaultValue={params.q}
            placeholder="Site ID, name, county, technician, supervisor…"
            className="pl-9"
            aria-label="Search sites"
          />
        </div>
        <Select name="region" defaultValue={f.region ?? ''} aria-label="Region">
          <option value="">All regions</option>
          {regions.map((r) => (
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
        <Select name="supervisor" defaultValue={f.supervisor ?? ''} aria-label="Supervisor">
          <option value="">All supervisors</option>
          {supervisors.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
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
        <div className="flex items-center justify-between gap-2 md:col-span-2 xl:col-span-6">
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
            <SortHeader label="Site ID" column="site_code" {...sortProps} />
            <SortHeader label="Site Name" column="site_name" {...sortProps} />
            {show('region') ? <SortHeader label="Region" column="region_name" {...sortProps} /> : null}
            {show('cluster') ? <SortHeader label="Cluster" column="cluster_name" {...sortProps} /> : null}
            {show('county') ? <SortHeader label="County" column="county_name" {...sortProps} /> : null}
            {show('technician') ? <TableHead>Technician</TableHead> : null}
            {show('supervisor') ? <TableHead>Supervisor</TableHead> : null}
            {show('pm') ? <TableHead>PM Status</TableHead> : null}
            {show('last') ? <SortHeader label="Last PM" column="last_pm_at" {...sortProps} /> : null}
            {show('next') ? <SortHeader label="Next PM" column="next_pm_due" {...sortProps} /> : null}
            {show('failures') ? <SortHeader label="Failures" column="open_failures" {...sortProps} /> : null}
            {show('actions') ? <SortHeader label="Corr. Actions" column="open_corrective_actions" {...sortProps} /> : null}
            {show('status') ? <SortHeader label="Site Status" column="status" {...sortProps} /> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sites.length === 0 ? (
            <EmptyRow colSpan={visibleColumns} message="No sites match these filters." />
          ) : (
            sites.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="whitespace-nowrap font-medium">
                  <Link href={`/sites/${s.id}`} className="hover:underline">
                    {s.site_code}
                  </Link>
                </TableCell>
                <TableCell>
                  <Link href={`/sites/${s.id}`} className="hover:underline">
                    {s.site_name}
                  </Link>
                  {s.is_demo ? (
                    <Badge tone="neutral" className="ml-2">
                      Demo
                    </Badge>
                  ) : null}
                </TableCell>
                {show('region') ? <TableCell>{s.region_name}</TableCell> : null}
                {show('cluster') ? <TableCell>{s.cluster_name ?? '—'}</TableCell> : null}
                {show('county') ? <TableCell>{s.county_name ?? '—'}</TableCell> : null}
                {show('technician') ? <TableCell>{s.technician_names ?? '—'}</TableCell> : null}
                {show('supervisor') ? <TableCell>{s.supervisor_name ?? '—'}</TableCell> : null}
                {show('pm') ? <TableCell className="whitespace-nowrap">{pmStatus(s, today)}</TableCell> : null}
                {show('last') ? <TableCell className="whitespace-nowrap">{formatDate(s.last_pm_at)}</TableCell> : null}
                {show('next') ? <TableCell className="whitespace-nowrap">{formatDate(s.next_pm_due)}</TableCell> : null}
                {show('failures') ? (
                  <TableCell>
                    <Badge tone={s.open_failures ? 'danger' : 'neutral'}>{s.open_failures ?? 0}</Badge>
                  </TableCell>
                ) : null}
                {show('actions') ? (
                  <TableCell>
                    <Badge tone={s.open_corrective_actions ? 'warning' : 'neutral'}>{s.open_corrective_actions ?? 0}</Badge>
                  </TableCell>
                ) : null}
                {show('status') ? (
                  <TableCell>
                    <Badge tone={s.status === 'ACTIVE' ? 'success' : 'neutral'}>{humanizeStatus(s.status ?? '')}</Badge>
                  </TableCell>
                ) : null}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <Pagination pathname="/sites" searchParams={sp} page={params.page} pageSize={params.pageSize} total={count ?? 0} />
    </div>
  );
}
