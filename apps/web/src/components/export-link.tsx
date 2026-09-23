import { Download } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';

type SearchParams = Record<string, string | string[] | undefined>;

/** "Export CSV" for the list as currently filtered (page and size are ignored by exports). */
export function ExportLink({ href, searchParams, label = 'Export CSV' }: { href: string; searchParams: SearchParams; label?: string }) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    const value = Array.isArray(v) ? v[0] : v;
    if (value && k !== 'page' && k !== 'size') q.set(k, value);
  }
  const url = q.size ? `${href}?${q.toString()}` : href;
  return (
    // A route handler (file download), so a plain anchor rather than client navigation.
    <a href={url} className={buttonVariants({ variant: 'outline' })} download>
      <Download aria-hidden />
      {label}
    </a>
  );
}
