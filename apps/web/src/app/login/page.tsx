import type { Metadata } from 'next';
import Link from 'next/link';
import { Brand } from '@/components/brand';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-primary px-4 py-12">
      <Brand inverted className="mb-8" />
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-xl">Sign in</CardTitle>
          <CardDescription>Preventive maintenance portal for telecom site power.</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm next={next} />
          <Link href="/forgot-password" className="mt-4 block text-center text-sm text-info hover:underline">
            Forgot your password?
          </Link>
          <p className="mt-6 text-xs text-muted-foreground">
            Accounts are created by your administrator. Contact your supervisor if you cannot sign in.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
