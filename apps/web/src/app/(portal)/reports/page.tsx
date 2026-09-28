import { PM_STATUS_TONE } from '@ipt/shared';
import { Download, FileText, History, Search } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Pagination } from '@/components/data-table/pagination';
import { EmptyRow } from '@/components/empty-row';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { loadOptional, loadPage, qs } from '@/lib/api/data';
import type { Region, Site, VisitSummary } from '@/lib/api/types';
import { hasPermission, requirePermission } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { parseTableParams, type SearchParams } from '@/lib/table-params';

export const metadata: Metadata = { title: 'Reports' };

const VISIT_STATUSES = [
  ['finished', 'Completed or approved'],
  ['APPROVED', 'Approved'],
  ['COMPLETED', 'Waiting for review'],
  ['REJECTED', 'Returned for correction'],
  ['IN_PROGRESS', 'In progress'],
] as const;

/** Reports: PM visit reports (PDF), CSV exports and PM history per site. */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const session = await requirePermission('reports.read');
  const p = parseTableParams(sp, { sortable: ['started'] as const, defaultSort: 'started', filters: ['status', 'from', 'to', 'site'] });
  const f = p.filters;
  const canExport = hasPermission(session, 'reports.export');
  const canVisits = hasPermission(session, 'pm_visits.read');
  const siteQuery = f.site?.trim();
  const [visits, regions, sites] = await Promise.all([
    canVisits
      ? loadPage<VisitSummary>(`/visits${qs({ status: f.status ?? 'finished', from: f.from, to: f.to, page: p.page, pageSize: p.pageSize })}`)
      : null,
    loadOptional<Region[]>('/org/hierarchy'),
    siteQuery && siteQuery.length >= 2 ? loadPage<Site>(`/sites${qs({ q: siteQuery, pageSize: 10 })}`) : null,
  ]);
  const shown = visits?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title="Reports" description="PM visit reports as PDF, spreadsheet exports (CSV) and each site's PM history — all from the records in your scope." />

      {canVisits ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">PM reports (PDF)</CardTitle>
            <CardDescription>The report of a PM visit, laid out like the PM report: site and visit, each section&apos;s readings and checklist, photos, failures raised, review and signature.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form method="get" className="grid gap-3 sm:grid-cols-4 sm:items-end">
              <div className="space-y-1.5">
                <Label htmlFor="status">Visits</Label>
                <Select id="status" name="status" defaultValue={f.status ?? 'finished'}>
                  {VISIT_STATUSES.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="from">Started from</Label>
                <Input id="from" name="from" type="date" defaultValue={f.from ?? ''} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="to">to</Label>
                <Input id="to" name="to" type="date" defaultValue={f.to ?? ''} />
              </div>
              <Button type="submit" className="w-fit">
                Apply
              </Button>
            </form>
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Site</TableHead>
                    <TableHead>Technician</TableHead>
                    <TableHead>Started</TableHead>
                    <TableHead>Completed</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Report</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.length ? (
                    shown.map((v) => (
                      <TableRow key={v.id}>
                        <TableCell className="whitespace-nowrap">
                          <Link href={`/visits/${v.id}`} className="font-medium hover:underline">
                            {v.site.siteCode}
                          </Link>{' '}
                          <span className="text-muted-foreground">{v.site.siteName}</span>
                        </TableCell>
                        <TableCell>{v.technician.fullName}</TableCell>
                        <TableCell className="whitespace-nowrap">{formatDateTime(v.startedAt)}</TableCell>
                        <TableCell className="whitespace-nowrap">{formatDateTime(v.completedAt)}</TableCell>
                        <TableCell>
                          <StatusBadge status={v.status === 'COMPLETED' ? 'WAITING_FOR_REVIEW' : v.status} tone={PM_STATUS_TONE[v.status]} />
                        </TableCell>
                        <TableCell>
                          <a href={`/files/visits/${v.id}/report.pdf`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 hover:underline">
                            <FileText className="size-4" aria-hidden />
                            PDF
                          </a>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <EmptyRow colSpan={6} message="No PM visits match." />
                  )}
                </TableBody>
              </Table>
            </div>
            {visits ? (
              <Pagination pathname="/reports" searchParams={sp} page={p.page} pageSize={p.pageSize} total={visits.total} />
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="size-4" aria-hidden />
            PM history of a site
          </CardTitle>
          <CardDescription>Every PM visit at a site with its result and the readings recorded on it.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <form method="get" role="search" className="flex max-w-lg gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden />
              <Input name="site" defaultValue={siteQuery ?? ''} placeholder="Site code or name" className="pl-9" aria-label="Find a site" minLength={2} />
            </div>
            <Button type="submit" variant="outline">
              Find
            </Button>
          </form>
          {sites ? (
            sites.items.length ? (
              <ul className="divide-y rounded-lg border text-sm">
                {sites.items.map((s) => (
                  <li key={s.id}>
                    <Link href={`/sites/${s.id}/history`} className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-muted/50">
                      <span>
                        <span className="font-medium">{s.siteCode}</span> <span className="text-muted-foreground">{s.siteName}</span>
                      </span>
                      <span className="text-muted-foreground">PM history →</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No site in your scope matches “{siteQuery}”.</p>
            )
          ) : null}
        </CardContent>
      </Card>

      {canExport ? (
        <section aria-labelledby="exports-heading" className="space-y-3">
          <div>
            <h2 id="exports-heading" className="text-lg font-semibold">
              Spreadsheet exports (CSV)
            </h2>
            <p className="text-sm text-muted-foreground">
              Opens in Excel or any spreadsheet. Every row in your scope that matches the filters is included. Each list page also has an “Export CSV” button that uses the list&apos;s own filters.
            </p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <ExportCard dataset="visits" title="PM visits" help="With their result and key readings (DC load, batteries, generator). Dates: when the PM started." regions={regions}>
              <StatusSelect options={[['', 'Any status'], ['APPROVED', 'Approved'], ['COMPLETED', 'Waiting for review'], ['REJECTED', 'Returned'], ['IN_PROGRESS', 'In progress']]} />
            </ExportCard>
            <ExportCard dataset="schedules" title="PM schedule" help="Planned PMs. Dates: the scheduled date." regions={regions}>
              <StatusSelect options={[['', 'Any status'], ['SCHEDULED', 'Scheduled'], ['OVERDUE', 'Overdue'], ['IN_PROGRESS', 'In progress'], ['COMPLETED', 'Completed'], ['APPROVED', 'Approved'], ['CANCELLED', 'Cancelled']]} />
            </ExportCard>
            <ExportCard dataset="failures" title="Failures" help="Dates: when the failure was detected." regions={regions}>
              <StatusSelect options={[['', 'Any status'], ['active', 'Not closed'], ['CLOSED', 'Closed']]} />
            </ExportCard>
            <ExportCard dataset="corrective-actions" title="Corrective actions" help="Dates: when the action was created." regions={regions}>
              <StatusSelect options={[['', 'Any status'], ['active', 'Open (not verified)'], ['VERIFIED', 'Verified'], ['CLOSED', 'Closed']]} />
            </ExportCard>
            <ExportCard dataset="sites" title="Sites" help="With their region, county, power equipment and the people assigned." regions={regions} dates={false}>
              <StatusSelect options={[['', 'Any status'], ['ACTIVE', 'Active'], ['INACTIVE', 'Inactive'], ['DECOMMISSIONED', 'Decommissioned']]} />
            </ExportCard>
            <ExportCard dataset="readings" title="Power readings" help="Readings from completed or approved PMs only. Dates: when recorded." regions={regions}>
              <div className="space-y-1.5">
                <Label htmlFor="readings-module">Readings</Label>
                <Select id="readings-module" name="module" defaultValue="dc">
                  <option value="dc">DC system</option>
                  <option value="battery">Batteries</option>
                  <option value="generator">Generator</option>
                </Select>
              </div>
            </ExportCard>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function StatusSelect({ options }: { options: readonly (readonly [string, string])[] }) {
  return (
    <div className="space-y-1.5">
      <Label>
        Status
        <Select name="status" defaultValue="" className="mt-1.5">
          {options.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
      </Label>
    </div>
  );
}

/** A plain GET form to the export relay, which downloads the file (empty fields are dropped there). */
function ExportCard({ dataset, title, help, regions, dates = true, children }: { dataset: string; title: string; help: string; regions: Region[] | null; dates?: boolean; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{help}</CardDescription>
      </CardHeader>
      <CardContent>
        <form method="get" action={`/exports/${dataset}.csv`} className="grid gap-3 sm:grid-cols-2 sm:items-end">
          {dates ? (
            <>
              <div className="space-y-1.5">
                <Label>
                  From
                  <Input name="from" type="date" className="mt-1.5" />
                </Label>
              </div>
              <div className="space-y-1.5">
                <Label>
                  To
                  <Input name="to" type="date" className="mt-1.5" />
                </Label>
              </div>
            </>
          ) : null}
          {regions && regions.length > 1 ? (
            <div className="space-y-1.5">
              <Label>
                Region
                <Select name="regionId" defaultValue="" className="mt-1.5">
                  <option value="">All in your scope</option>
                  {regions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </Select>
              </Label>
            </div>
          ) : null}
          {children}
          <Button type="submit" variant="outline" className="w-fit sm:col-span-2">
            <Download aria-hidden />
            Download CSV
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
