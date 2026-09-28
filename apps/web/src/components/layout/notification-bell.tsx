'use client';

import { Bell } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const EVERY_MS = 60_000;

/** The header bell: unread count, refreshed on every page change and once a minute. */
export function NotificationBell() {
  const pathname = usePathname();
  const [unread, setUnread] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    const load = () =>
      fetch('/notifications-count', { cache: 'no-store' })
        .then((r) => (r.ok ? (r.json() as Promise<{ unread: number }>) : null))
        .then((b) => live && b && setUnread(b.unread))
        .catch(() => undefined);
    void load();
    const timer = setInterval(() => void load(), EVERY_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [pathname]);

  const label = unread ? `Notifications, ${unread} unread` : 'Notifications';
  return (
    <Link href="/notifications" className="relative inline-flex size-10 items-center justify-center rounded-md hover:bg-muted" aria-label={label} title={label}>
      <Bell className="size-5" aria-hidden />
      {unread ? (
        <span className="absolute right-1 top-1 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] font-semibold leading-4 text-white tabular-nums" aria-hidden>
          {unread > 99 ? '99+' : unread}
        </span>
      ) : null}
    </Link>
  );
}
