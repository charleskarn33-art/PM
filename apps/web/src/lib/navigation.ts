export type NavIcon =
  | 'dashboard'
  | 'sites'
  | 'technicians'
  | 'supervisors'
  | 'schedule'
  | 'visits'
  | 'failures'
  | 'actions'
  | 'analytics'
  | 'reports'
  | 'users'
  | 'organization'
  | 'templates'
  | 'settings'
  | 'audit'
  | 'notifications'
  | 'profile';

export interface NavItem {
  label: string;
  href: string;
  icon: NavIcon;
  /** Shown when the user holds any of these API permissions; undefined = every signed-in user. */
  permissions?: readonly string[];
  /** Also required (all of): e.g. supervisors are listed only for people who oversee supervisors. */
  requires?: readonly string[];
  /** Delivery phase when not yet built; shown disabled with its phase. */
  plannedPhase?: number;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const NAVIGATION: NavSection[] = [
  {
    title: 'Operations',
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: 'dashboard', permissions: ['analytics.read'] },
      { label: 'Sites', href: '/sites', icon: 'sites', permissions: ['sites.read'] },
      { label: 'Technicians', href: '/technicians', icon: 'technicians', permissions: ['users.read'] },
      { label: 'Supervisors', href: '/supervisors', icon: 'supervisors', permissions: ['users.read'], requires: ['analytics.read'] },
      { label: 'PM Schedule', href: '/schedule', icon: 'schedule', permissions: ['pm_schedules.read'] },
      { label: 'PM Visits & Review', href: '/visits', icon: 'visits', permissions: ['pm_visits.read'] },
      { label: 'Failures', href: '/failures', icon: 'failures', permissions: ['failures.read'] },
      { label: 'Corrective Actions', href: '/corrective-actions', icon: 'actions', permissions: ['corrective_actions.read'] },
    ],
  },
  {
    title: 'Insights',
    items: [
      { label: 'Analytics', href: '/analytics', icon: 'analytics', permissions: ['analytics.read'], plannedPhase: 10 },
      { label: 'Reports', href: '/reports', icon: 'reports', permissions: ['reports.read'], plannedPhase: 11 },
    ],
  },
  {
    title: 'Administration',
    items: [
      { label: 'Users', href: '/admin/users', icon: 'users', permissions: ['users.manage'] },
      { label: 'Organization', href: '/admin/organization', icon: 'organization', permissions: ['org.manage'] },
      { label: 'PM Templates', href: '/admin/templates', icon: 'templates', permissions: ['pm_templates.manage'] },
      { label: 'Settings', href: '/admin/settings', icon: 'settings', permissions: ['settings.manage'] },
      { label: 'Audit Log', href: '/admin/audit', icon: 'audit', permissions: ['audit.read'], plannedPhase: 13 },
    ],
  },
  {
    title: 'Account',
    items: [
      { label: 'Notifications', href: '/notifications', icon: 'notifications', plannedPhase: 12 },
      { label: 'My Profile', href: '/profile', icon: 'profile' },
    ],
  },
];

export function isVisibleTo(item: NavItem, permissions: readonly string[]): boolean {
  const any = !item.permissions || item.permissions.some((p) => permissions.includes(p));
  const all = !item.requires || item.requires.every((p) => permissions.includes(p));
  return any && all;
}

/** Navigation for a user's permissions; empty sections are removed. */
export function navigationFor(permissions: readonly string[]): NavSection[] {
  return NAVIGATION.map((section) => ({ ...section, items: section.items.filter((item) => isVisibleTo(item, permissions)) })).filter((section) => section.items.length > 0);
}

/** Breadcrumb trail for a pathname, based on the navigation labels. */
export function breadcrumbsFor(pathname: string): { label: string; href?: string }[] {
  const all = [...NAVIGATION.flatMap((s) => s.items), { label: 'Search', href: '/search', icon: 'dashboard' as const }];
  const match = all.filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`)).sort((a, b) => b.href.length - a.href.length)[0];
  const trail: { label: string; href?: string }[] = [{ label: 'IPT PowerTech PM', href: '/dashboard' }];
  if (match) trail.push({ label: match.label });
  return trail;
}

/** Where a user lands after signing in: the dashboard if they may see it, else the first page they may open. */
export function homeFor(permissions: readonly string[]): string {
  return navigationFor(permissions).flatMap((s) => s.items).find((i) => !i.plannedPhase)?.href ?? '/profile';
}
