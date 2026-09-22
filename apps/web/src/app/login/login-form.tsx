'use client';

import { AlertCircle, Loader2 } from 'lucide-react';
import { useActionState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { signIn, type LoginState } from './actions';

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(signIn, {});

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <input type="hidden" name="next" value={next ?? ''} />
      {state.error ? (
        <Alert tone="danger" className="flex items-start gap-2">
          <AlertCircle className="mt-0.5" aria-hidden />
          <span>{state.error}</span>
        </Alert>
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="email">Email address</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.email}
          aria-invalid={Boolean(state.error)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <Button type="submit" variant="accent" size="lg" className="w-full" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
