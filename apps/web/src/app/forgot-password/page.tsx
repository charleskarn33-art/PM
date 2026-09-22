'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Brand } from '@/components/brand';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { requestPasswordReset, type ForgotState } from './actions';

export default function ForgotPasswordPage() {
  const [state, action, pending] = useActionState<ForgotState, FormData>(requestPasswordReset, {});
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-primary px-4 py-12">
      <Brand inverted className="mb-8" />
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-xl">Reset password</CardTitle>
          <CardDescription>We will email you a link to choose a new password.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {state.sent ? (
            <Alert tone="success">If an account exists for that address, a reset link is on its way.</Alert>
          ) : (
            <form action={action} className="space-y-4">
              {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
              <div className="space-y-2">
                <Label htmlFor="email">Email address</Label>
                <Input id="email" name="email" type="email" autoComplete="email" required />
              </div>
              <Button type="submit" variant="accent" size="lg" className="w-full" disabled={pending}>
                Send reset link
              </Button>
            </form>
          )}
          <Link href="/login" className="block text-center text-sm text-info hover:underline">
            Back to sign in
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
