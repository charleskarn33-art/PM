import { Skeleton } from '@/components/ui/skeleton';

export default function DashboardLoading() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Loading dashboard">
      <Skeleton className="h-8 w-48" />
      {[6, 4, 6].map((n, row) => (
        <div key={row} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          {Array.from({ length: n }, (_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      ))}
    </div>
  );
}
