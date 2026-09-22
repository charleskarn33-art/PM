import type { StatusTone } from '@ipt/shared';
import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const TONE_ICON: Record<StatusTone | 'primary', string> = {
  primary: 'bg-primary/10 text-primary',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
  neutral: 'bg-neutral-soft text-neutral',
};

interface KpiCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  tone?: StatusTone | 'primary';
  hint?: string;
}

export function KpiCard({ label, value, icon: Icon, tone = 'primary', hint }: KpiCardProps) {
  return (
    <Card className="flex items-start gap-4 p-5">
      <span className={cn('flex size-11 shrink-0 items-center justify-center rounded-lg', TONE_ICON[tone])}>
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </div>
    </Card>
  );
}
