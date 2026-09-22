import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { PAGE_SIZES, tableHref, type SearchParams } from '@/lib/table-params';
import { cn } from '@/lib/utils';

interface PaginationProps {
  pathname: string;
  searchParams: SearchParams;
  page: number;
  pageSize: number;
  total: number;
}

export function Pagination({ pathname, searchParams, page, pageSize, total }: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const link = (p: number) => tableHref(pathname, searchParams, { page: p === 1 ? null : p });
  return (
    <nav aria-label="Pagination" className="flex flex-col items-center justify-between gap-3 text-sm sm:flex-row">
      <p className="text-muted-foreground">
        {from}–{to} of {total}
      </p>
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">Rows:</span>
        {PAGE_SIZES.map((size) => (
          <Link
            key={size}
            href={tableHref(pathname, searchParams, { size: size === PAGE_SIZES[0] ? null : size, page: null })}
            aria-current={size === pageSize ? 'true' : undefined}
            className={cn(buttonVariants({ variant: size === pageSize ? 'secondary' : 'ghost', size: 'sm' }))}
          >
            {size}
          </Link>
        ))}
        <span className="mx-2 text-muted-foreground">
          Page {page} of {pages}
        </span>
        {page > 1 ? (
          <Link href={link(page - 1)} className={buttonVariants({ variant: 'outline', size: 'sm' })} aria-label="Previous page">
            <ChevronLeft />
          </Link>
        ) : null}
        {page < pages ? (
          <Link href={link(page + 1)} className={buttonVariants({ variant: 'outline', size: 'sm' })} aria-label="Next page">
            <ChevronRight />
          </Link>
        ) : null}
      </div>
    </nav>
  );
}
