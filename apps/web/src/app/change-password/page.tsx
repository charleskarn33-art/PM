import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Brand } from '@/components/brand';
import { SignOutButtonClient } from '@/components/layout/sign-out-client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError } from '@/lib/api/client';
import { api, readTokens } from '@/lib/api/server';
import type { ApiMe } from '@/lib/auth';
import { ChangePasswordForm } from './change-password-form';

export const metadata: Metadata = { title: 'Change password' };

export default async function ChangePasswordPage() {
  const { accessToken } = await readTokens();
  if (!accessToken) redirect('/login');
  let me: ApiMe;
  try {
    me = (await api<ApiMe>('/auth/me')).data;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) redirect('/login');
    if (e instanceof ApiError && e.code === 'ACCOUNT_INACTIVE') redirect('/account-inactive');
    throw e;
  }
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-primary px-4 py-12">
      <Brand inverted className="mb-8" />
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-xl">{me.mustChangePassword ? 'Choose your password' : 'Change password'}</CardTitle>
          <CardDescription>
            {me.mustChangePassword
              ? `You signed in as ${me.email} with a temporary password. Choose your own to continue.`
              : `Change the password for ${me.email}. You will be signed out on your other devices.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ChangePasswordForm temporary={me.mustChangePassword} />
          <SignOutButtonClient />
        </CardContent>
      </Card>
    </main>
  );
}
