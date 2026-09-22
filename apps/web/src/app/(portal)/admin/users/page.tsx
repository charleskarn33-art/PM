import { ROLE_LABELS, type AppRole } from '@ipt/shared';
import { Search, UserPlus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyRow } from '@/components/empty-row';
import { Pagination } from '@/components/data-table/pagination';
import { SortHeader } from '@/components/data-table/sort-header';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireCapability } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { pageRange, parseTableParams, toIlikePattern, type SearchParams } from '@/lib/table-params';

export const metadata: Metadata = { title: 'Users' };

const SORTS = ['full_name', 'email', 'role', 'last_login_at', 'created_at'] as const;

export default async function UsersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  await requireCapability('manage_users');
  const params = parseTableParams(sp, { sortable: SORTS, defaultSort: 'full_name', filters: ['role', 'status'] });
  const supabase = await createClient();

  let query = supabase.from('profiles').select('id, full_name, email, role, is_active, last_login_at, regions!profiles_region_id_fkey(name)', { count: 'exact' });
  if (params.filters.role && params.filters.role in ROLE_LABELS) query = query.eq('role', params.filters.role as AppRole);
  if (params.filters.status === 'active') query = query.eq('is_active', true);
  if (params.filters.status === 'inactive') query = query.eq('is_active', false);
  if (params.q) {
    const p = toIlikePattern(params.q);
    query = query.or(`full_name.ilike.${p},email.ilike.${p}`);
  }
  const { from, to } = pageRange(params.page, params.pageSize);
  const { data, count, error } = await query
    .order(params.sort, { ascending: params.dir === 'asc', nullsFirst: false })
    .range(from, to);
  if (error) throw new Error(`Unable to load users: ${error.message}`);
  const users = data ?? [];
  const sortProps = { pathname: '/admin/users', searchParams: sp, sort: params.sort, dir: params.dir };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        description="Accounts, roles, activation and data scope."
        actions={
          <Link href="/admin/users/invite" className={buttonVariants({ variant: 'accent' })}>
            <UserPlus aria-hidden />
            Invite user
          </Link>
        }
      />
      <form method="get" role="search" className="grid gap-3 rounded-xl border bg-card p-4 md:grid-cols-4">
        <div className="relative md:col-span-2">
          <Search className="absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden />
          <Input name="q" defaultValue={params.q} placeholder="Name or email" className="pl-9" aria-label="Search users" />
        </div>
        <Select name="role" defaultValue={params.filters.role ?? ''} aria-label="Role">
          <option value="">All roles</option>
          {Object.entries(ROLE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <div className="flex gap-2">
          <Select name="status" defaultValue={params.filters.status ?? ''} aria-label="Status">
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="inactive">Pending / inactive</option>
          </Select>
          <Button type="submit">Apply</Button>
        </div>
      </form>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <SortHeader label="Name" column="full_name" {...sortProps} />
            <SortHeader label="Email" column="email" {...sortProps} />
            <SortHeader label="Role" column="role" {...sortProps} />
            <TableHead>Home region</TableHead>
            <TableHead>Status</TableHead>
            <SortHeader label="Last sign-in" column="last_login_at" {...sortProps} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.length === 0 ? (
            <EmptyRow colSpan={6} message="No users match these filters." />
          ) : (
            users.map((u) => (
              <TableRow key={u.id}>
                <TableCell>
                  <Link href={`/admin/users/${u.id}`} className="font-medium hover:underline">
                    {u.full_name || '(no name)'}
                  </Link>
                </TableCell>
                <TableCell>{u.email}</TableCell>
                <TableCell>{ROLE_LABELS[u.role]}</TableCell>
                <TableCell>{u.regions?.name ?? '—'}</TableCell>
                <TableCell>
                  <Badge tone={u.is_active ? 'success' : 'warning'}>{u.is_active ? 'Active' : 'Pending'}</Badge>
                </TableCell>
                <TableCell>{u.last_login_at ? new Date(u.last_login_at).toLocaleString('en-GB') : '—'}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <Pagination pathname="/admin/users" searchParams={sp} page={params.page} pageSize={params.pageSize} total={count ?? 0} />
    </div>
  );
}
