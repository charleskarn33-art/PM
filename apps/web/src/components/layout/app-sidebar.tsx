'use client';

import {
  BarChart3,
  Building2,
  CalendarClock,
  ClipboardCheck,
  FileText,
  History,
  LayoutDashboard,
  ListChecks,
  MapPin,
  Settings,
  TriangleAlert,
  UserCog,
  UserRound,
  HardHat,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Brand } from '@/components/brand';
import type { NavIcon, NavSection } from '@/lib/navigation';
import { cn } from '@/lib/utils';

const ICONS: Record<NavIcon, LucideIcon> = {
  dashboard: LayoutDashboard,
  sites: MapPin,
  technicians: HardHat,
  supervisors: UserCog,
  schedule: CalendarClock,
  visits: ClipboardCheck,
  failures: TriangleAlert,
  actions: Wrench,
  analytics: BarChart3,
  reports: FileText,
  users: Users,
  organization: Building2,
  templates: ListChecks,
  settings: Settings,
  audit: History,
  profile: UserRound,
};

export function AppSidebar({ sections, onNavigate }: { sections: NavSection[]; onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="px-5 py-5">
        <Brand inverted />
      </div>
      <div className="flex-1 space-y-6 overflow-y-auto px-3 pb-6">
        {sections.map((section) => (
          <div key={section.title}>
            <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/60">
              {section.title}
            </p>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const Icon = ICONS[item.icon];
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                if (item.plannedPhase) {
                  return (
                    <li key={item.href}>
                      <span
                        className="flex cursor-not-allowed items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground/45"
                        title={`Not yet available — scheduled for Phase ${item.plannedPhase}`}
                        aria-disabled="true"
                      >
                        <Icon className="size-4" aria-hidden />
                        <span className="flex-1">{item.label}</span>
                        <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-medium">
                          Phase {item.plannedPhase}
                        </span>
                      </span>
                    </li>
                  );
                }
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors hover:bg-sidebar-active hover:text-white',
                        active && 'bg-sidebar-active font-medium text-sidebar-active-foreground shadow-[inset_3px_0_0_var(--accent)]',
                      )}
                    >
                      <Icon className="size-4" aria-hidden />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
