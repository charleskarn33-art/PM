import { ROLE_LABELS } from '@ipt/shared';
import type { Metadata } from 'next';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requireSession } from '@/lib/auth';
import { ProfileForm } from './profile-form';

export const metadata: Metadata = { title: 'My Profile' };

export default async function ProfilePage() {
  const session = await requireSession();
  const { profile } = session;

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">My Profile</h1>
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>Your role and data scope are managed by a Super Admin.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Email</dt>
              <dd className="font-medium">{profile.email}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Role</dt>
              <dd>
                <Badge tone="info">{ROLE_LABELS[session.role]}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Region scope</dt>
              <dd className="font-medium">
                {session.role === 'super_admin' || session.role === 'viewer'
                  ? 'All regions'
                  : session.regionNames.join(', ') || '—'}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Last sign-in</dt>
              <dd className="font-medium">
                {profile.last_login_at ? new Date(profile.last_login_at).toLocaleString('en-GB') : '—'}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Contact details</CardTitle>
        </CardHeader>
        <CardContent>
          <ProfileForm fullName={profile.full_name} phone={profile.phone} />
        </CardContent>
      </Card>
    </div>
  );
}
