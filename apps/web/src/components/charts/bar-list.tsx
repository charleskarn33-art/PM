import { cn } from '@/lib/utils';

export interface BarListItem {
  label: string;
  value: number | null;
  /** Text shown at the bar tip (defaults to the value). */
  display?: string;
  href?: string;
  /** A CSS colour token, e.g. var(--status-critical). Defaults to the sequential hue. */
  color?: string;
  note?: string;
}

/**
 * Ranked horizontal bars in plain HTML: labels never clip, values sit at the
 * bar tip in text ink, and the list works without JavaScript.
 */
export function BarList({ items, max, className }: { items: BarListItem[]; max?: number; className?: string }) {
  const top = max ?? Math.max(0, ...items.map((i) => i.value ?? 0));
  return (
    <ul className={cn('space-y-2', className)}>
      {items.map((i) => {
        const width = top > 0 && i.value ? Math.max(1, (i.value / top) * 100) : 0;
        const label = i.href ? (
          <a href={i.href} className="hover:underline">
            {i.label}
          </a>
        ) : (
          i.label
        );
        return (
          <li key={i.label} className="grid grid-cols-[minmax(0,12rem)_1fr] items-center gap-3 text-sm sm:grid-cols-[minmax(0,16rem)_1fr]">
            <span className="truncate text-muted-foreground" title={i.label}>
              {label}
              {i.note ? <span className="ml-1 text-xs">({i.note})</span> : null}
            </span>
            <span className="flex items-center gap-3">
              <span className="flex h-3.5 flex-1 items-center" aria-hidden>
                <span className="h-full rounded-r-[4px]" style={{ width: `${width}%`, minWidth: i.value ? 2 : 0, background: i.color ?? 'var(--seq-450)' }} />
              </span>
              <span className="min-w-12 whitespace-nowrap text-right font-medium tabular-nums">{i.display ?? (i.value == null ? '—' : i.value.toLocaleString())}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
