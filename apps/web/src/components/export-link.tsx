import { Download } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';

/**
 * Downloads a CSV export of what the list shows (same filters). A plain link:
 * the web server relays the file from the API with the user's session.
 */
export function ExportLink({ dataset, query, label = 'Export CSV' }: { dataset: string; query: string; label?: string }) {
  return (
    <a href={`/exports/${dataset}.csv${query}`} className={buttonVariants({ variant: 'outline' })} download>
      <Download aria-hidden />
      {label}
    </a>
  );
}
