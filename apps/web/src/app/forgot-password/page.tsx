import type { Metadata } from 'next';
import Link from 'next/link';
import { Brand } from '@/components/brand';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Forgot password' };

/** No e-mail service is configured: an administrator gives a temporary password (Admin → Users). */
export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-primary px-4 py-12">
      <Brand inverted className="mb-8" />
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-xl">Forgot your password?</CardTitle>
          <CardDescription>
            Ask your supervisor or a system administrator to give you a temporary password. You will choose your own
            password the next time you sign in.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/login" className="block text-center text-sm text-info hover:underline">
            Back to sign in
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
