'use client';

import { Columns3 } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/** Column visibility, persisted in the URL (`hide=a,b`) so views are shareable. */
export function ColumnToggle({ columns }: { columns: { key: string; label: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const hidden = new Set((searchParams.get('hide') ?? '').split(',').filter(Boolean));

  function toggle(key: string) {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    const params = new URLSearchParams(searchParams.toString());
    if (next.size) params.set('hide', [...next].join(','));
    else params.delete('hide');
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <details className="relative">
      <summary className="inline-flex h-10 cursor-pointer list-none items-center gap-2 rounded-md border border-input bg-card px-3 text-sm hover:bg-secondary">
        <Columns3 className="size-4" aria-hidden />
        Columns
      </summary>
      <div className="absolute right-0 z-20 mt-1 w-56 rounded-md border bg-card p-2 shadow-lg">
        {columns.map((c) => (
          <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
            <input type="checkbox" checked={!hidden.has(c.key)} onChange={() => toggle(c.key)} />
            {c.label}
          </label>
        ))}
      </div>
    </details>
  );
}
