import { Search } from 'lucide-react';
import Link from 'next/link';
import { Pagination } from '@/components/data-table/pagination';
import { EmptyRow } from '@/components/empty-row';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { Page } from '@/lib/api/data';
import type { Region } from '@/lib/api/types';
import type { SearchParams } from '@/lib/table-params';

export interface PersonRow<W> {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  employeeCode: string | null;
  isActive: boolean;
  homeRegion: { id: string; name: string } | null;
  regions: { id: string; name: string }[];
  workload: W;
}

export interface Column<W> {
  label: string;
  value: (w: W) => number | string | null;
  /** Highlight when the value is above zero. */
  alert?: boolean;
}

/** People with their workload, filters in the URL. */
export function PeopleTable<W>({
  pathname,
  sp,
  page,
  params,
  regions,
  columns,
  profileLink,
}: {
  pathname: string;
  sp: SearchParams;
  page: Page<PersonRow<W>>;
  params: { q: string; region: string; page: number; pageSize: number };
  regions: Region[];
  columns: Column<W>[];
  profileLink: boolean;
}) {
  return (
    <>
      <form method="get" role="search" className="grid gap-3 rounded-xl border bg-card p-4 md:grid-cols-[1fr_16rem_auto]">
        <div className="relative">
          <Search className="absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden />
          <Input name="q" defaultValue={params.q} placeholder="Name, e-mail or employee code" className="pl-9" aria-label="Search" />
        </div>
        {regions.length ? (
          <Select name="region" defaultValue={params.region} aria-label="Region">
            <option value="">All regions</option>
            {regions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        ) : null}
        <div className="flex gap-2">
          <Button type="submit">Apply</Button>
          <Link href={pathname} className={buttonVariants({ variant: 'ghost' })}>
            Reset
          </Link>
        </div>
      </form>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Name</TableHead>
            <TableHead>Contact</TableHead>
            <TableHead>Region</TableHead>
            {columns.map((c) => (
              <TableHead key={c.label} className="text-right">
                {c.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {page.items.length === 0 ? (
            <EmptyRow colSpan={3 + columns.length} message="Nobody matches these filters." />
          ) : (
            page.items.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">
                  {profileLink ? (
                    <Link href={`/admin/users/${p.id}`} className="hover:underline">
                      {p.fullName}
                    </Link>
                  ) : (
                    p.fullName
                  )}
                  {!p.isActive ? (
                    <Badge tone="neutral" className="ml-2">
                      Inactive
                    </Badge>
                  ) : null}
                  {p.employeeCode ? <p className="text-xs text-muted-foreground">{p.employeeCode}</p> : null}
                </TableCell>
                <TableCell className="text-sm">
                  {p.email}
                  {p.phone ? <p className="text-xs text-muted-foreground">{p.phone}</p> : null}
                </TableCell>
                <TableCell className="text-sm">{[...new Set([p.homeRegion?.name, ...p.regions.map((r) => r.name)].filter(Boolean))].join(', ') || '—'}</TableCell>
                {columns.map((c) => {
                  const v = c.value(p.workload);
                  return (
                    <TableCell key={c.label} className="text-right tabular-nums">
                      {c.alert && typeof v === 'number' && v > 0 ? <Badge tone="danger">{v}</Badge> : (v ?? '—')}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <Pagination pathname={pathname} searchParams={sp} page={params.page} pageSize={params.pageSize} total={page.total} />
    </>
  );
}
