import { ROLE_LABELS } from '@ipt/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api/server';
import { requireSession } from '@/lib/auth';
import { ProfileForm } from './profile-form';

export const metadata: Metadata = { title: 'My Profile' };

export default async function ProfilePage() {
  const session = await requireSession();
  const { data: profile } = await api<{ email: string; fullName: string; phone: string | null; lastLoginAt: string | null }>('/me/profile');

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
                {session.isGlobal ? 'All regions' : session.regionNames.join(', ') || 'Assigned sites only'}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Last sign-in</dt>
              <dd className="font-medium">
                {profile.lastLoginAt ? new Date(profile.lastLoginAt).toLocaleString('en-GB') : '—'}
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
          <ProfileForm fullName={profile.fullName} phone={profile.phone} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Security</CardTitle>
          <CardDescription>Changing your password signs you out on your other devices.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button asChild variant="outline">
            <Link href="/change-password">Change password</Link>
          </Button>
          <form action="/auth/signout-everywhere" method="post">
            <Button type="submit" variant="outline">
              Sign out on all devices
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
