import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyRow } from '@/components/empty-row';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireRole } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Supervisors' };

export default async function SupervisorsPage() {
  const session = await requireRole(['super_admin', 'regional_manager', 'viewer']);
  const supabase = await createClient();
  const { data, error } = await supabase.from('supervisor_overview').select('*').order('full_name');
  if (error) throw new Error(`Unable to load supervisors: ${error.message}`);
  const rows = data ?? [];
  const isAdmin = session.role === 'super_admin';

  return (
    <div className="space-y-6">
      <PageHeader title="Supervisors" description="Regional supervisors, their regions, counties, sites and technicians." />
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Supervisor</TableHead>
            <TableHead>Regions</TableHead>
            <TableHead>Assigned counties</TableHead>
            <TableHead>Sites</TableHead>
            <TableHead>Technicians</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <EmptyRow colSpan={6} message="No supervisors in your scope." />
          ) : (
            rows.map((s) => (
              <TableRow key={s.id}>
                <TableCell>
                  {isAdmin ? (
                    <Link href={`/admin/users/${s.id}`} className="font-medium hover:underline">
                      {s.full_name || s.email}
                    </Link>
                  ) : (
                    <span className="font-medium">{s.full_name || s.email}</span>
                  )}
                  <div className="text-xs text-muted-foreground">{s.email}</div>
                </TableCell>
                <TableCell>{s.region_names ?? '—'}</TableCell>
                <TableCell>{s.county_names ?? '—'}</TableCell>
                <TableCell>
                  <Link href={`/sites?supervisor=${s.id}`} className="hover:underline">
                    {s.site_count ?? 0}
                  </Link>
                </TableCell>
                <TableCell>
                  <Link href={`/technicians?supervisor=${s.id}`} className="hover:underline">
                    {s.technician_count ?? 0}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge tone={s.is_active ? 'success' : 'neutral'}>{s.is_active ? 'Active' : 'Inactive'}</Badge>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">
        PM completion, overdue PM and failure figures per supervisor are added with the analytics in Phase 7.
      </p>
    </div>
  );
}
