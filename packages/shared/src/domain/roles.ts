import type { Enums } from '../database.types';

export type AppRole = Enums<'app_role'>;

export const ROLE_LABELS: Record<AppRole, string> = {
  super_admin: 'Super Admin',
  regional_manager: 'Regional Manager',
  regional_supervisor: 'Regional Supervisor',
  technician: 'Technician',
  maintenance: 'Maintenance',
  viewer: 'Viewer',
};

/**
 * UI capabilities per role. These only decide what the interface offers;
 * the database (RLS + guard triggers) is the actual enforcement layer.
 */
export type Capability =
  | 'manage_users'
  | 'manage_organization'
  | 'manage_templates'
  | 'manage_settings'
  | 'manage_assignments'
  | 'schedule_pm'
  | 'review_pm'
  | 'perform_pm'
  | 'manage_corrective_actions'
  | 'work_corrective_actions'
  | 'view_reports'
  | 'view_audit_log';

const CAPABILITIES: Record<AppRole, readonly Capability[]> = {
  super_admin: [
    'manage_users',
    'manage_organization',
    'manage_templates',
    'manage_settings',
    'manage_assignments',
    'schedule_pm',
    'review_pm',
    'manage_corrective_actions',
    'view_reports',
    'view_audit_log',
  ],
  regional_manager: ['view_reports'],
  regional_supervisor: [
    'manage_assignments',
    'schedule_pm',
    'review_pm',
    'manage_corrective_actions',
    'view_reports',
  ],
  technician: ['perform_pm', 'work_corrective_actions'],
  maintenance: ['work_corrective_actions'],
  viewer: ['view_reports'],
};

export function can(role: AppRole | null | undefined, capability: Capability): boolean {
  return role != null && CAPABILITIES[role].includes(capability);
}

/** Roles the field (mobile) app is built for. */
export const MOBILE_ROLES: readonly AppRole[] = ['technician', 'maintenance'];

export function isMobileRole(role: AppRole | null | undefined): boolean {
  return role != null && MOBILE_ROLES.includes(role);
}
