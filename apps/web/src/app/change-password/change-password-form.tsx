'use client';

import { useActionState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { changePassword, type ChangePasswordState } from './actions';

export function ChangePasswordForm({ temporary }: { temporary: boolean }) {
  const [state, action, pending] = useActionState<ChangePasswordState, FormData>(changePassword, {});
  return (
    <form action={action} className="space-y-4">
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      <div className="space-y-2">
        <Label htmlFor="currentPassword">{temporary ? 'Temporary password' : 'Current password'}</Label>
        <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="newPassword">New password</Label>
        <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} required />
        <p className="text-xs text-muted-foreground">At least 12 characters. A short sentence is easy to remember and hard to guess.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm">Repeat the new password</Label>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </div>
      <Button type="submit" variant="accent" size="lg" className="w-full" disabled={pending}>
        Save password
      </Button>
    </form>
  );
}
