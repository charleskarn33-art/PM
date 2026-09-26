import type { AppRole } from '@ipt/shared';

/** What the app shows about the signed-in user (from the API's `/me/profile`). */
export interface AccountProfile {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  /** The role that decides the app's screens (field roles first). */
  role: AppRole | null;
  is_active: boolean;
  must_change_password: boolean;
}

export interface ApiProfile {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  roles: { code: string; name: string }[];
}

/** Field roles first (the phone app is for them), then by privilege. */
const ORDER: [string, AppRole][] = [
  ['TECHNICIAN', 'technician'],
  ['MAINTENANCE_USER', 'maintenance'],
  ['SUPER_ADMIN', 'super_admin'],
  ['REGIONAL_MANAGER', 'regional_manager'],
  ['REGIONAL_SUPERVISOR', 'regional_supervisor'],
  ['VIEWER', 'viewer'],
];

export function appRole(codes: readonly string[]): AppRole | null {
  return ORDER.find(([code]) => codes.includes(code))?.[1] ?? null;
}

export function toAccountProfile(p: ApiProfile): AccountProfile {
  return {
    id: p.id,
    email: p.email,
    full_name: p.fullName,
    phone: p.phone,
    role: appRole(p.roles.map((r) => r.code)),
    is_active: p.isActive,
    must_change_password: p.mustChangePassword,
  };
}
