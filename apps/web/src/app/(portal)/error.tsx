'use client';

import { AlertTriangle, RotateCw } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export default function PortalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-xl space-y-4 py-12">
      <Alert tone="danger" className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5" aria-hidden />
        <div>
          <p className="font-medium">Something went wrong loading this page.</p>
          <p className="mt-1 text-sm">{error.message || 'Unexpected error.'}</p>
          {error.digest ? <p className="mt-1 text-xs opacity-75">Reference: {error.digest}</p> : null}
        </div>
      </Alert>
      <Button onClick={reset} variant="outline">
        <RotateCw aria-hidden />
        Try again
      </Button>
    </div>
  );
}
