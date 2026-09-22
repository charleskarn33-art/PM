'use client';

import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function SignOutButtonClient() {
  return (
    <form action="/auth/signout" method="post">
      <Button type="submit" variant="outline" size="sm" aria-label="Sign out">
        <LogOut aria-hidden />
        <span className="hidden sm:inline">Sign out</span>
      </Button>
    </form>
  );
}
