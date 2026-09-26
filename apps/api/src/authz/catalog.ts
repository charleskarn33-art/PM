/**
 * Explicit permissions and the system roles that hold them. The seed writes
 * this catalogue to the `permissions`, `roles` and `role_permissions` tables;
 * the API checks permissions from the database (Phase 3).
 *
 * A permission says WHAT a role may do. WHERE it may do it — the user's
 * regions, assigned sites, own work — is the organisational scope, checked
 * separately for every request.
 */

export const PERMISSIONS = {
  'users.read': 'View users and their roles',
  'users.manage': 'Create users, change roles, activation and scope',
  'roles.read': 'View roles and their permissions',
  'org.read': 'View regions, clusters and counties',
  'org.manage': 'Create and edit regions, clusters and counties',
  'sites.read': 'View sites',
  'sites.manage': 'Create and edit sites',
  'assignments.read': 'View site assignments and their history',
  'assignments.manage': 'Assign technicians and supervisors to sites',
  'pm_templates.read': 'View PM templates and checklists',
  'pm_templates.manage': 'Create and version PM templates, sections, items and failure rules',
  'pm_schedules.read': 'View PM schedules',
  'pm_schedules.manage': 'Create and change PM schedules',
  'pm_visits.read': 'View PM visits and their results',
  'pm_visits.perform': 'Start, fill in and submit PM visits on assigned sites',
  'pm_visits.review': 'Approve or return submitted PM visits',
  'failures.read': 'View failures',
  'failures.report': 'Report a failure found on site',
  'failures.manage': 'Change failure severity and status, close failures',
  'corrective_actions.read': 'View corrective actions',
  'corrective_actions.manage': 'Create, assign, verify and close corrective actions',
  'corrective_actions.work': 'Work on assigned corrective actions (start, notes, photos, complete)',
  'reports.read': 'View and download PM reports',
  'reports.export': 'Export data (CSV)',
  'analytics.read': 'View dashboards and analytics',
  'audit.read': 'View the audit log',
  'settings.manage': 'Change system settings (geofence, thresholds, notifications)',
} as const;

export type PermissionCode = keyof typeof PERMISSIONS;

const ALL = Object.keys(PERMISSIONS) as PermissionCode[];
const READ: PermissionCode[] = [
  'org.read',
  'sites.read',
  'assignments.read',
  'pm_templates.read',
  'pm_schedules.read',
  'pm_visits.read',
  'failures.read',
  'corrective_actions.read',
  'reports.read',
  'analytics.read',
];

export interface RoleDefinition {
  name: string;
  description: string;
  permissions: readonly PermissionCode[];
}

export const SYSTEM_ROLES = {
  SUPER_ADMIN: {
    name: 'Super Admin',
    description: 'Full access to all data, users and configuration.',
    permissions: ALL,
  },
  REGIONAL_MANAGER: {
    name: 'Regional Manager',
    description: 'Oversight of sites, people, PM performance, failures and reports in assigned regions.',
    permissions: [...READ, 'users.read', 'roles.read', 'reports.export'],
  },
  REGIONAL_SUPERVISOR: {
    name: 'Regional Supervisor',
    description: 'Assigns technicians, schedules and reviews PM, and manages failures and corrective actions in assigned regions.',
    permissions: [
      ...READ,
      'users.read',
      'roles.read',
      'assignments.manage',
      'pm_schedules.manage',
      'pm_visits.review',
      'failures.report',
      'failures.manage',
      'corrective_actions.manage',
      'reports.export',
    ],
  },
  TECHNICIAN: {
    name: 'Technician',
    description: 'Performs preventive maintenance on assigned sites and works on assigned corrective actions.',
    permissions: [
      'sites.read',
      'pm_templates.read',
      'pm_schedules.read',
      'pm_visits.read',
      'pm_visits.perform',
      'failures.read',
      'failures.report',
      'corrective_actions.read',
      'corrective_actions.work',
    ],
  },
  MAINTENANCE_USER: {
    name: 'Maintenance User',
    description: 'Works on and completes assigned corrective actions.',
    permissions: ['sites.read', 'failures.read', 'corrective_actions.read', 'corrective_actions.work'],
  },
  VIEWER: {
    name: 'Viewer',
    description: 'Read-only access to dashboards, data and reports.',
    permissions: [...READ, 'reports.export'],
  },
} as const satisfies Record<string, RoleDefinition>;

export type RoleCode = keyof typeof SYSTEM_ROLES;
export const ROLE_CODES = Object.keys(SYSTEM_ROLES) as RoleCode[];
