import type { RoleCode } from './catalog.js';
import type { Prisma } from '../generated/prisma/client.js';

type Db = Pick<Prisma.TransactionClient, 'user'>;

/** Roles whose access is not limited to regions or assignments. */
export const GLOBAL_ROLES: readonly RoleCode[] = ['SUPER_ADMIN'];

/**
 * What a user may do (permissions, from their roles) and where (their scope).
 * Loaded from the database on every request, so a change of role, scope or
 * activation applies immediately — nothing is cached in the access token.
 */
export interface UserAccess {
  id: string;
  email: string;
  fullName: string;
  isActive: boolean;
  mustChangePassword: boolean;
  roles: RoleCode[];
  permissions: string[];
  /** Regions in the user's scope (managers, supervisors, viewers, …). */
  regionIds: string[];
  /** True when a role grants access everywhere (Super Admin). */
  isGlobal: boolean;
}

/** Access of one user, or null when the user does not exist. */
export async function loadAccess(db: Db, userId: string): Promise<(UserAccess & { sessionsValidAfter: Date | null }) | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      fullName: true,
      isActive: true,
      mustChangePassword: true,
      sessionsValidAfter: true,
      roles: { select: { role: { select: { code: true, permissions: { select: { permission: { select: { code: true } } } } } } } },
      regionScopes: { select: { regionId: true } },
    },
  });
  if (!user) return null;
  const roles = user.roles.map((r) => r.role.code as RoleCode).sort();
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    sessionsValidAfter: user.sessionsValidAfter,
    roles,
    permissions: [...new Set(user.roles.flatMap((r) => r.role.permissions.map((p) => p.permission.code)))].sort(),
    regionIds: user.regionScopes.map((s) => s.regionId).sort(),
    isGlobal: roles.some((r) => GLOBAL_ROLES.includes(r)),
  };
}

/** The public view of a user's access (what `/auth/me` returns). */
export function publicAccess(a: UserAccess): UserAccess {
  const { id, email, fullName, isActive, mustChangePassword, roles, permissions, regionIds, isGlobal } = a;
  return { id, email, fullName, isActive, mustChangePassword, roles, permissions, regionIds, isGlobal };
}
