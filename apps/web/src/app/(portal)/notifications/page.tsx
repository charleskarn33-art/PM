import { Bell, CheckCheck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Pagination } from '@/components/data-table/pagination';
import { PageHeader } from '@/components/page-header';
import { Button, buttonVariants } from '@/components/ui/button';
import { qs } from '@/lib/api/data';
import { api } from '@/lib/api/server';
import { requireSession } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { parseTableParams, type SearchParams } from '@/lib/table-params';
import { cn } from '@/lib/utils';
import { markAllRead, openNotification } from './actions';

export const metadata: Metadata = { title: 'Notifications' };

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
}

/** The signed-in user's notifications, newest first. */
export default async function NotificationsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  await requireSession();
  const p = parseTableParams(sp, { sortable: ['created'] as const, defaultSort: 'created', filters: ['unread'] });
  const unreadOnly = p.filters.unread === 'true';
  const res = await api<Notification[]>(`/notifications${qs({ unread: unreadOnly ? 'true' : undefined, page: p.page, pageSize: p.pageSize })}`);
  const meta = res.meta as { total: number; unread: number };
  const items = res.data;

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Notifications"
        description="What needs your attention: PMs scheduled, submitted and reviewed, critical failures, corrective actions assigned, completed or sent back, and reminders."
        actions={
          meta.unread ? (
            <form action={markAllRead}>
              <Button type="submit" variant="outline">
                <CheckCheck aria-hidden />
                Mark all read
              </Button>
            </form>
          ) : null
        }
      />
      <div className="flex gap-2 text-sm">
        <Link href="/notifications" className={buttonVariants({ variant: unreadOnly ? 'ghost' : 'secondary', size: 'sm' })} aria-current={!unreadOnly ? 'page' : undefined}>
          All
        </Link>
        <Link href="/notifications?unread=true" className={buttonVariants({ variant: unreadOnly ? 'secondary' : 'ghost', size: 'sm' })} aria-current={unreadOnly ? 'page' : undefined}>
          Unread ({meta.unread})
        </Link>
      </div>
      {items.length ? (
        <ul className="divide-y rounded-xl border bg-card">
          {items.map((n) => (
            <li key={n.id}>
              <form action={openNotification.bind(null, n.id, n.entityType, n.entityId)}>
                <button type="submit" className={cn('flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted/50', !n.readAt && 'bg-info-soft/40')}>
                  <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-info')} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className={cn('block text-sm', !n.readAt && 'font-semibold')}>
                      {n.title}
                      {!n.readAt ? <span className="sr-only"> (unread)</span> : null}
                    </span>
                    <span className="block text-sm text-muted-foreground">{n.body}</span>
                  </span>
                  <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(n.createdAt)}</span>
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-xl border bg-card py-12 text-center text-sm text-muted-foreground">
          <Bell className="size-6" aria-hidden />
          {unreadOnly ? 'No unread notifications.' : 'No notifications yet.'}
        </div>
      )}
      <Pagination pathname="/notifications" searchParams={sp} page={p.page} pageSize={p.pageSize} total={meta.total} />
    </div>
  );
}
