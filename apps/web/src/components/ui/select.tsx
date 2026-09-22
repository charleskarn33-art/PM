import * as React from 'react';
import { cn } from '@/lib/utils';

/** Native select styled like the Input component (accessible, works without JS). */
function Select({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      data-slot="select"
      className={cn(
        'flex h-10 w-full rounded-md border border-input bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 aria-invalid:border-danger',
        className,
      )}
      {...props}
    />
  );
}

export { Select };

/**
 * Select for use inside React form actions. React applies a select's
 * `defaultValue` only at mount, but resets forms to their defaults after every
 * action; keying on the default remounts the select whenever the saved or
 * submitted value changes, so a reset never reverts it to a stale option.
 */
function FormSelect({ defaultValue, ...props }: React.ComponentProps<'select'> & { defaultValue?: string }) {
  return <Select key={`default:${defaultValue ?? ''}`} defaultValue={defaultValue} {...props} />;
}

export { FormSelect };
