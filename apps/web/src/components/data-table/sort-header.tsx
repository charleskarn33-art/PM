import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import Link from 'next/link';
import { TableHead } from '@/components/ui/table';
import { tableHref, type SearchParams } from '@/lib/table-params';

interface SortHeaderProps {
  label: string;
  column: string;
  pathname: string;
  searchParams: SearchParams;
  sort: string;
  dir: 'asc' | 'desc';
  className?: string;
}

export function SortHeader({ label, column, pathname, searchParams, sort, dir, className }: SortHeaderProps) {
  const active = sort === column;
  const nextDir = active && dir === 'asc' ? 'desc' : 'asc';
  const Icon = !active ? ArrowUpDown : dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <TableHead className={className} aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <Link
        href={tableHref(pathname, searchParams, { sort: column, dir: nextDir, page: null })}
        className="inline-flex items-center gap-1 hover:text-foreground"
      >
        {label}
        <Icon className="size-3.5" aria-hidden />
      </Link>
    </TableHead>
  );
}
