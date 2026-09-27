import { humanizeStatus } from '@ipt/shared';
import { Plus, Search } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Pagination } from '@/components/data-table/pagination';
import { EmptyRow } from '@/components/empty-row';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { load, loadPage, qs } from '@/lib/api/data';
import type { UserSummary } from '@/lib/api/types';
import { requirePermission } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { parseTableParams, type SearchParams } from '@/lib/table-params';

export const metadata: Metadata = { title: 'Users' };

export default async function UsersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const session = await requirePermission('users.manage');
  const p = parseTableParams(sp, { sortable: ['name'] as const, defaultSort: 'name', filters: ['role', 'active'] });
  const [page, roles] = await Promise.all([
    loadPage<UserSummary & { lockedUntil: string | null; mustChangePassword: boolean }>(`/users${qs({ q: p.q, role: p.filters.role, active: p.filters.active, page: p.page, pageSize: p.pageSize })}`),
    load<{ code: string; name: string }[]>('/roles'),
  ]);
  const roleName = new Map(roles.map((r) => [r.code, r.name]));
  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        description="Accounts, roles and access scope."
        actions={
          session.isGlobal ? (
            <Link href="/admin/users/new" className={buttonVariants({ variant: 'accent' })}>
              <Plus aria-hidden />
              New user
            </Link>
          ) : null
        }
      />
      <form method="get" role="search" className="grid gap-3 rounded-xl border bg-card p-4 md:grid-cols-[1fr_14rem_12rem_auto]">
        <div className="relative">
          <Search className="absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden />
          <Input name="q" defaultValue={p.q} placeholder="Name, e-mail or employee code" className="pl-9" aria-label="Search users" />
        </div>
        <Select name="role" defaultValue={p.filters.role ?? ''} aria-label="Role">
          <option value="">Any role</option>
          {roles.map((r) => (
            <option key={r.code} value={r.code}>
              {r.name}
            </option>
          ))}
        </Select>
        <Select name="active" defaultValue={p.filters.active ?? ''} aria-label="Status">
          <option value="">Active and inactive</option>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </Select>
        <div className="flex gap-2">
          <Button type="submit">Apply</Button>
          <Link href="/admin/users" className={buttonVariants({ variant: 'ghost' })}>
            Reset
          </Link>
        </div>
      </form>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Name</TableHead>
            <TableHead>E-mail</TableHead>
            <TableHead>Roles</TableHead>
            <TableHead>Last sign-in</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {page.items.length === 0 ? (
            <EmptyRow colSpan={5} message="No users match these filters." />
          ) : (
            page.items.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">
                  <Link href={`/admin/users/${u.id}`} className="hover:underline">
                    {u.fullName}
                  </Link>
                  {u.employeeCode ? <p className="text-xs text-muted-foreground">{u.employeeCode}</p> : null}
                </TableCell>
                <TableCell>{u.email}</TableCell>
                <TableCell className="space-x-1">
                  {u.roles.map((r) => (
                    <Badge key={r} tone="outline">
                      {roleName.get(r) ?? humanizeStatus(r)}
                    </Badge>
                  ))}
                </TableCell>
                <TableCell className="whitespace-nowrap">{formatDateTime(u.lastLoginAt)}</TableCell>
                <TableCell className="space-x-1">
                  <Badge tone={u.isActive ? 'success' : 'neutral'}>{u.isActive ? 'Active' : 'Inactive'}</Badge>
                  {u.mustChangePassword ? <Badge tone="warning">Must change password</Badge> : null}
                  {u.lockedUntil && new Date(u.lockedUntil) > new Date() ? <Badge tone="danger">Locked</Badge> : null}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <Pagination pathname="/admin/users" searchParams={sp} page={p.page} pageSize={p.pageSize} total={page.total} />
    </div>
  );
}
