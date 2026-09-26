import 'server-only';
import { can, type AppRole, type Capability } from '@ipt/shared';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import { ApiError } from '@/lib/api/client';
import { api, readTokens } from '@/lib/api/server';

/** What `GET /auth/me` returns. */
export interface ApiMe {
  id: string;
  email: string;
  fullName: string;
  isActive: boolean;
  mustChangePassword: boolean;
  roles: string[];
  permissions: string[];
  regionIds: string[];
  isGlobal: boolean;
  regions: { id: string; code: string; name: string }[];
}

export interface SessionContext {
  userId: string;
  email: string;
  fullName: string;
  /** API role codes (a user may hold several). */
  roles: string[];
  /** Permissions from the API; the API enforces them on every request. */
  permissions: string[];
  isGlobal: boolean;
  regionIds: string[];
  regionNames: string[];
  /**
   * The user's main role in the older UI vocabulary, used by screens that
   * have not yet moved to permissions (navigation, legacy pages).
   */
  role: AppRole;
}

/** Most-privileged first: the main role of a user holding several. */
const ROLE_ORDER: [string, AppRole][] = [
  ['SUPER_ADMIN', 'super_admin'],
  ['REGIONAL_MANAGER', 'regional_manager'],
  ['REGIONAL_SUPERVISOR', 'regional_supervisor'],
  ['TECHNICIAN', 'technician'],
  ['MAINTENANCE_USER', 'maintenance'],
  ['VIEWER', 'viewer'],
];

export function mainRole(roles: readonly string[]): AppRole | null {
  return ROLE_ORDER.find(([code]) => roles.includes(code))?.[1] ?? null;
}

/**
 * The signed-in user, from the API, once per request. Redirects to /login
 * without a valid session, to /account-inactive for an inactive account or
 * one without a role, and to /change-password while a temporary password
 * must be replaced.
 */
export const requireSession = cache(async (): Promise<SessionContext> => {
  const { accessToken } = await readTokens();
  if (!accessToken) redirect('/login');
  let me: ApiMe;
  try {
    me = (await api<ApiMe>('/auth/me')).data;
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 401) redirect('/login');
      if (e.code === 'ACCOUNT_INACTIVE') redirect('/account-inactive');
      if (e.code === 'PASSWORD_CHANGE_REQUIRED') redirect('/change-password');
    }
    throw e;
  }
  if (me.mustChangePassword) redirect('/change-password');
  const role = mainRole(me.roles);
  if (!role) redirect('/account-inactive');
  return {
    userId: me.id,
    email: me.email,
    fullName: me.fullName,
    roles: me.roles,
    permissions: me.permissions,
    isGlobal: me.isGlobal,
    regionIds: me.regionIds,
    regionNames: me.regions.map((r) => r.name),
    role,
  };
});

/** True when the user holds the API permission. Screens use this to decide what to offer; the API decides what is allowed. */
export function hasPermission(session: SessionContext, permission: string): boolean {
  return session.permissions.includes(permission);
}

/**
 * Page-level guard for role-specific screens. The API still enforces access;
 * this only avoids rendering screens a role cannot use. Responds 404 so
 * restricted areas are not advertised.
 */
export async function requireCapability(capability: Capability): Promise<SessionContext> {
  const session = await requireSession();
  if (!can(session.role, capability)) notFound();
  return session;
}

export async function requireRole(roles: readonly AppRole[]): Promise<SessionContext> {
  const session = await requireSession();
  if (!roles.includes(session.role)) notFound();
  return session;
}
