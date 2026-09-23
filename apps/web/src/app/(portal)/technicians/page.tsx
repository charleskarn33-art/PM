import { Search } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { EmptyRow } from '@/components/empty-row';
import { Pagination } from '@/components/data-table/pagination';
import { SortHeader } from '@/components/data-table/sort-header';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireRole } from '@/lib/auth';
import { loadRegions, loadSupervisors } from '@/lib/org-data';
import { createClient } from '@/lib/supabase/server';
import { isBeyondLastPage, pageRange, parseTableParams, tableHref, toIlikePattern, type SearchParams } from '@/lib/table-params';

export const metadata: Metadata = { title: 'Technicians' };

const SORTS = ['full_name', 'region_name', 'supervisor_name', 'assigned_sites', 'open_pm', 'overdue_pm'] as const;

export default async function TechniciansPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const session = await requireRole(['super_admin', 'regional_manager', 'regional_supervisor', 'viewer']);
  const params = parseTableParams(sp, { sortable: SORTS, defaultSort: 'full_name', filters: ['region', 'supervisor', 'active'] });
  const supabase = await createClient();

  let query = supabase.from('technician_overview').select('*', { count: 'exact' });
  if (params.filters.region) query = query.eq('region_id', params.filters.region);
  if (params.filters.supervisor) query = query.eq('supervisor_id', params.filters.supervisor);
  if (params.filters.active !== 'all') query = query.eq('is_active', params.filters.active !== 'inactive');
  if (params.q) {
    const p = toIlikePattern(params.q);
    query = query.or(`full_name.ilike.${p},email.ilike.${p},employee_code.ilike.${p}`);
  }
  const { from, to } = pageRange(params.page, params.pageSize);
  const [{ data, count, error }, regions, supervisors] = await Promise.all([
    query.order(params.sort, { ascending: params.dir === 'asc', nullsFirst: false }).order('full_name').range(from, to),
    loadRegions(supabase),
    loadSupervisors(supabase),
  ]);
  if (isBeyondLastPage(error)) redirect(tableHref('/technicians', sp, { page: null }));
  if (error) throw new Error(`Unable to load technicians: ${error.message}`);
  const rows = data ?? [];
  const sortProps = { pathname: '/technicians', searchParams: sp, sort: params.sort, dir: params.dir };
  const isAdmin = session.role === 'super_admin';

  return (
    <div className="space-y-6">
      <PageHeader title="Technicians" description="Field technicians, their supervisor and current workload." />
      <form method="get" role="search" className="grid gap-3 rounded-xl border bg-card p-4 md:grid-cols-5">
        <div className="relative md:col-span-2">
          <Search className="absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden />
          <Input name="q" defaultValue={params.q} placeholder="Name, email or employee code" className="pl-9" aria-label="Search technicians" />
        </div>
        <Select name="region" defaultValue={params.filters.region ?? ''} aria-label="Region">
          <option value="">All regions</option>
          {regions.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>
        <Select name="supervisor" defaultValue={params.filters.supervisor ?? ''} aria-label="Supervisor">
          <option value="">All supervisors</option>
          {supervisors.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <div className="flex gap-2">
          <Select name="active" defaultValue={params.filters.active ?? ''} aria-label="Status">
            <option value="">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All</option>
          </Select>
          <Button type="submit">Apply</Button>
        </div>
      </form>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <SortHeader label="Technician" column="full_name" {...sortProps} />
            <TableHead>Employee code</TableHead>
            <SortHeader label="Region" column="region_name" {...sortProps} />
            <SortHeader label="Supervisor" column="supervisor_name" {...sortProps} />
            <SortHeader label="Assigned sites" column="assigned_sites" {...sortProps} />
            <SortHeader label="Open PM" column="open_pm" {...sortProps} />
            <SortHeader label="Overdue PM" column="overdue_pm" {...sortProps} />
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <EmptyRow colSpan={8} message="No technicians match these filters." />
          ) : (
            rows.map((t) => (
              <TableRow key={t.id}>
                <TableCell>
                  {isAdmin ? (
                    <Link href={`/admin/users/${t.id}`} className="font-medium hover:underline">
                      {t.full_name || t.email}
                    </Link>
                  ) : (
                    <span className="font-medium">{t.full_name || t.email}</span>
                  )}
                  <div className="text-xs text-muted-foreground">{t.email}</div>
                </TableCell>
                <TableCell>{t.employee_code ?? '—'}</TableCell>
                <TableCell>{t.region_name ?? '—'}</TableCell>
                <TableCell>{t.supervisor_name ?? '—'}</TableCell>
                <TableCell>{t.assigned_sites ?? 0}</TableCell>
                <TableCell>{t.open_pm ?? 0}</TableCell>
                <TableCell>
                  <Badge tone={t.overdue_pm ? 'danger' : 'neutral'}>{t.overdue_pm ?? 0}</Badge>
                </TableCell>
                <TableCell>
                  <Badge tone={t.is_active ? 'success' : 'neutral'}>{t.is_active ? 'Active' : 'Inactive'}</Badge>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <Pagination pathname="/technicians" searchParams={sp} page={params.page} pageSize={params.pageSize} total={count ?? 0} />
      <p className="text-xs text-muted-foreground">
        Technicians are created by inviting a user with the Technician role.{' '}
        {isAdmin ? (
          <Link href="/admin/users/invite" className={buttonVariants({ variant: 'link', size: 'sm' })}>
            Invite a technician
          </Link>
        ) : null}
      </p>
    </div>
  );
}
