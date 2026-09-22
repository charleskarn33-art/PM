import type { Metadata } from 'next';
import { Brand } from '@/components/brand';
import { SignOutButtonClient } from '@/components/layout/sign-out-client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Account pending activation' };

export default function AccountInactivePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-primary px-4 py-12">
      <Brand inverted className="mb-8" />
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Account pending activation</CardTitle>
          <CardDescription>
            You are signed in, but your account has not been activated or has no role assigned yet. A Super Admin
            must activate your account before you can access PM data.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignOutButtonClient />
        </CardContent>
      </Card>
    </main>
  );
}
