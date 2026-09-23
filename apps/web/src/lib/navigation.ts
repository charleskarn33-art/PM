import { can, type AppRole, type Capability } from '@ipt/shared';

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
  | 'profile';

export interface NavItem {
  label: string;
  href: string;
  icon: NavIcon;
  /** Capability required to see the item; undefined = every active role. */
  capability?: Capability;
  /** Roles that may see the item regardless of capability (read-only views). */
  roles?: readonly AppRole[];
  /** Delivery phase when not yet implemented; shown disabled with its phase. */
  plannedPhase?: number;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

const READ_ROLES: readonly AppRole[] = ['super_admin', 'regional_manager', 'regional_supervisor', 'viewer'];

export const NAVIGATION: NavSection[] = [
  {
    title: 'Operations',
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: 'dashboard' },
      { label: 'Sites', href: '/sites', icon: 'sites' },
      { label: 'Technicians', href: '/technicians', icon: 'technicians', roles: READ_ROLES },
      { label: 'Supervisors', href: '/supervisors', icon: 'supervisors', roles: ['super_admin', 'regional_manager', 'viewer'] },
      { label: 'PM Schedule', href: '/schedule', icon: 'schedule', roles: READ_ROLES },
      { label: 'PM Visits & Review', href: '/visits', icon: 'visits', roles: READ_ROLES },
      { label: 'Failures', href: '/failures', icon: 'failures', plannedPhase: 6 },
      { label: 'Corrective Actions', href: '/corrective-actions', icon: 'actions', plannedPhase: 6 },
    ],
  },
  {
    title: 'Insights',
    items: [
      { label: 'Analytics', href: '/analytics', icon: 'analytics', capability: 'view_reports', plannedPhase: 7 },
      { label: 'Reports', href: '/reports', icon: 'reports', capability: 'view_reports', plannedPhase: 8 },
    ],
  },
  {
    title: 'Administration',
    items: [
      { label: 'Users', href: '/admin/users', icon: 'users', capability: 'manage_users' },
      {
        label: 'Organization',
        href: '/admin/organization',
        icon: 'organization',
        capability: 'manage_organization',
      },
      { label: 'PM Templates', href: '/admin/templates', icon: 'templates', capability: 'manage_templates' },
      { label: 'Settings', href: '/admin/settings', icon: 'settings', capability: 'manage_settings' },
      { label: 'Audit Log', href: '/admin/audit', icon: 'audit', capability: 'view_audit_log', plannedPhase: 8 },
    ],
  },
  {
    title: 'Account',
    items: [{ label: 'My Profile', href: '/profile', icon: 'profile' }],
  },
];

export function isVisibleTo(item: NavItem, role: AppRole): boolean {
  if (item.roles?.includes(role)) return true;
  if (item.capability) return can(role, item.capability);
  return !item.roles;
}

/** Navigation filtered for a role; empty sections are removed. */
export function navigationFor(role: AppRole): NavSection[] {
  return NAVIGATION.map((section) => ({
    ...section,
    items: section.items.filter((item) => isVisibleTo(item, role)),
  })).filter((section) => section.items.length > 0);
}

/** Breadcrumb trail for a pathname, based on the navigation labels. */
export function breadcrumbsFor(pathname: string): { label: string; href?: string }[] {
  const all = NAVIGATION.flatMap((s) => s.items);
  const match = all
    .filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
  const trail: { label: string; href?: string }[] = [{ label: 'IPT PowerTech PM', href: '/dashboard' }];
  if (match) trail.push({ label: match.label });
  return trail;
}
