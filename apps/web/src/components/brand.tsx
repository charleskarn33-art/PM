import { Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Brand({ className, inverted = false }: { className?: string; inverted?: boolean }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <span className="flex size-9 items-center justify-center rounded-lg bg-accent text-white">
        <Zap className="size-5" aria-hidden />
      </span>
      <span className="leading-tight">
        <span className={cn('block text-sm font-bold tracking-wide', inverted ? 'text-white' : 'text-primary')}>
          IPT PowerTech
        </span>
        <span className={cn('block text-xs', inverted ? 'text-sidebar-foreground' : 'text-muted-foreground')}>
          PM System · Liberia
        </span>
      </span>
    </div>
  );
}
