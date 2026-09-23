import { humanizeStatus } from '@ipt/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { requireSession } from '@/lib/auth';
import { notificationHref } from '@/lib/notifications';
import { createClient } from '@/lib/supabase/server';
import { cn } from '@/lib/utils';
import { markAllNotificationsRead, markNotificationRead } from './actions';

export const metadata: Metadata = { title: 'Notifications' };
const when = (v: string) => new Date(v).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

export default async function NotificationsPage() {
  await requireSession();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('notifications')
    .select('id, type, title, body, entity_type, entity_id, read_at, created_at')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw new Error(`Unable to load notifications: ${error.message}`);
  const rows = data ?? [];
  const unread = rows.filter((n) => !n.read_at).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description={unread ? `${unread} unread` : 'All caught up.'}
        actions={
          unread ? (
            <form action={markAllNotificationsRead}>
              <Button type="submit" variant="outline">
                Mark all as read
              </Button>
            </form>
          ) : null
        }
      />
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">No notifications yet.</p> : null}
      <Card className="divide-y p-0">
        {rows.map((n) => {
          const href = notificationHref(n.entity_type, n.entity_id);
          return (
            <div key={n.id} className={cn('flex flex-wrap items-start justify-between gap-3 p-4', !n.read_at && 'bg-info-soft/40')}>
              <div className="min-w-0">
                <p className={cn('text-sm', !n.read_at && 'font-semibold')}>
                  {href ? (
                    <Link href={href} className="hover:underline">
                      {n.title}
                    </Link>
                  ) : (
                    n.title
                  )}
                </p>
                {n.body ? <p className="text-sm text-muted-foreground">{n.body}</p> : null}
                <p className="mt-1 text-xs text-muted-foreground">
                  {humanizeStatus(n.type)} · {when(n.created_at)}
                </p>
              </div>
              {!n.read_at ? (
                <form action={markNotificationRead}>
                  <input type="hidden" name="id" value={n.id} />
                  <Button type="submit" size="sm" variant="ghost">
                    Mark read
                  </Button>
                </form>
              ) : null}
            </div>
          );
        })}
      </Card>
    </div>
  );
}
