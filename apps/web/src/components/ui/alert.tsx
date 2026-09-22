import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '@/lib/utils';

const alertVariants = cva('relative w-full rounded-lg border px-4 py-3 text-sm [&_svg]:size-4', {
  variants: {
    tone: {
      info: 'border-info/30 bg-info-soft text-info',
      warning: 'border-warning/30 bg-warning-soft text-warning',
      danger: 'border-danger/30 bg-danger-soft text-danger',
      success: 'border-success/30 bg-success-soft text-success',
    },
  },
  defaultVariants: { tone: 'info' },
});

function Alert({ className, tone, ...props }: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return <div data-slot="alert" role="alert" className={cn(alertVariants({ tone }), className)} {...props} />;
}

export { Alert };
