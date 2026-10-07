import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { load } from '@/lib/api/data';
import type { Region } from '@/lib/api/types';
import { hasPermission, requirePermission } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { AccountButton, DetailsForm, RegionsForm, RolesForm, TemporaryPasswordForm } from '../user-forms';

export const metadata: Metadata = { title: 'User' };

interface UserDetail {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  employeeCode: string | null;
  isActive: boolean;
  homeRegionId: string | null;
  lastLoginAt: string | null;
  mustChangePassword: boolean;
  lockedUntil: string | null;
  isDemo: boolean;
  createdAt: string;
  roles: { code: string; name: string }[];
  regions: { id: string; name: string }[];
}

export default async function UserPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string; passwordError?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const session = await requirePermission('users.manage');
  const [u, roles, regions] = await Promise.all([load<UserDetail>(`/users/${id}`), load<{ code: string; name: string; description: string }[]>('/roles'), load<Region[]>('/org/hierarchy')]);
  const regionOptions = regions.map((r) => ({ id: r.id, label: r.name }));
  const locked = u.lockedUntil != null && new Date(u.lockedUntil) > new Date();
  const self = u.id === session.userId;
  const admin = session.isGlobal;

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title={u.fullName}
        description={u.email}
        actions={
          <>
            <Badge tone={u.isActive ? 'success' : 'neutral'}>{u.isActive ? 'Active' : 'Inactive'}</Badge>
            {u.mustChangePassword ? <Badge tone="warning">Must change password</Badge> : null}
            {locked ? <Badge tone="danger">Sign-in locked</Badge> : null}
            {u.isDemo ? <Badge tone="neutral">Demo</Badge> : null}
            {hasPermission(session, 'audit.read') ? (
              <>
                <Link href={`/admin/audit?entityType=user&entityId=${u.id}`} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                  Changes to this user
                </Link>
                <Link href={`/admin/audit?actorId=${u.id}`} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                  What they did
                </Link>
              </>
            ) : null}
          </>
        }
      />
      {sp.created ? <Alert tone="success">User created.</Alert> : null}
      {sp.passwordError ? <Alert tone="danger">The temporary password was not set: {sp.passwordError}</Alert> : null}
      <p className="text-sm text-muted-foreground">
        Created {formatDateTime(u.createdAt)} · last sign-in {formatDateTime(u.lastLoginAt)}
      </p>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Details</CardTitle>
          </CardHeader>
          <CardContent>
            {admin ? (
              <DetailsForm user={u} regions={regionOptions} />
            ) : (
              <p className="text-sm">
                {u.phone ?? 'No phone'} · {u.employeeCode ?? 'No employee code'}
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Account</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {admin && !self ? (
              <>
                {u.isActive ? <AccountButton id={u.id} step="deactivate" label="Deactivate account" variant="destructive" /> : <AccountButton id={u.id} step="activate" label="Activate account" />}
                {locked ? <AccountButton id={u.id} step="unlock" label="Unlock sign-in" /> : null}
                <TemporaryPasswordForm id={u.id} />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{self ? 'You cannot change your own account here; use My Profile.' : 'Only an administrator can change accounts.'}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Roles</CardTitle>
          </CardHeader>
          <CardContent>
            {admin && !self ? (
              <RolesForm id={u.id} roles={roles.map((r) => ({ id: r.code, label: r.name, description: r.description }))} selected={u.roles.map((r) => r.code)} />
            ) : (
              <p className="text-sm">{u.roles.map((r) => r.name).join(', ')}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Regions in scope</CardTitle>
          </CardHeader>
          <CardContent>
            {admin ? <RegionsForm id={u.id} regions={regionOptions} selected={u.regions.map((r) => r.id)} /> : <p className="text-sm">{u.regions.map((r) => r.name).join(', ') || 'None'}</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
