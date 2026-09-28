'use client';

import { ChevronRight, Menu, Search, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { SignOutButtonClient } from '@/components/layout/sign-out-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { breadcrumbsFor, type NavSection } from '@/lib/navigation';
import { AppSidebar } from './app-sidebar';
import { NotificationBell } from './notification-bell';

interface PortalShellProps {
  sections: NavSection[];
  userName: string;
  roleLabel: string;
  children: React.ReactNode;
}

export function PortalShell({ sections, userName, roleLabel, children }: PortalShellProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const crumbs = breadcrumbsFor(pathname);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="sticky top-0 hidden h-screen lg:block">
        <AppSidebar sections={sections} />
      </aside>

      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button className="absolute inset-0 bg-black/40" aria-label="Close navigation" onClick={() => setOpen(false)} />
          <div className="relative h-full w-72 max-w-[85%]">
            <AppSidebar sections={sections} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-card/95 px-4 backdrop-blur lg:px-8">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)} aria-label="Open navigation">
            {open ? <X /> : <Menu />}
          </Button>
          <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
            <ol className="flex items-center gap-1.5 truncate text-sm text-muted-foreground">
              {crumbs.map((crumb, i) => (
                <li key={crumb.label} className="flex items-center gap-1.5">
                  {i > 0 ? <ChevronRight className="size-3.5" aria-hidden /> : null}
                  {crumb.href && i < crumbs.length - 1 ? (
                    <Link href={crumb.href} className="hover:text-foreground">
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className="font-medium text-foreground">{crumb.label}</span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
          <form action="/search" method="get" role="search" className="relative hidden md:block">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden />
            <input
              name="q"
              minLength={2}
              maxLength={100}
              placeholder="Search sites, failures, actions, people"
              aria-label="Search"
              className="h-9 w-72 rounded-md border bg-background pl-8 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </form>
          <Link href="/search" className="inline-flex size-10 items-center justify-center rounded-md hover:bg-muted md:hidden" aria-label="Search">
            <Search className="size-5" aria-hidden />
          </Link>
          <NotificationBell />
          <div className="hidden text-right sm:block">
            <p className="text-sm font-medium leading-tight">{userName}</p>
            <Badge tone="outline" className="mt-0.5">
              {roleLabel}
            </Badge>
          </div>
          <SignOutButtonClient />
        </header>
        <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
