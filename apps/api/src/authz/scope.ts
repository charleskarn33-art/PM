import type { Prisma } from '../generated/prisma/client.js';
import type { AuthUser } from '../auth/auth-user.js';

/**
 * Organisational scope: WHERE a user may act. Permissions say what; these
 * filters say on which records. Every list and lookup of scoped data goes
 * through them, so an out-of-scope record behaves as if it did not exist.
 *
 * - Super Admin: everything.
 * - Everyone else: sites in the regions of their scope, plus sites they are
 *   actively assigned to (technicians, supervisors).
 */

type ScopeUser = Pick<AuthUser, 'id' | 'isGlobal' | 'regionIds'>;

/** Sites the user may see; undefined means no restriction. */
export function siteScope(user: ScopeUser): Prisma.SiteWhereInput | undefined {
  if (user.isGlobal) return undefined;
  return {
    OR: [{ regionId: { in: user.regionIds } }, { assignments: { some: { userId: user.id, active: true } } }],
  };
}

/** Regions the user may see: their scope and the regions of their assigned sites. */
export function regionScope(user: ScopeUser): Prisma.RegionWhereInput | undefined {
  if (user.isGlobal) return undefined;
  return {
    OR: [{ id: { in: user.regionIds } }, { sites: { some: { assignments: { some: { userId: user.id, active: true } } } } }],
  };
}

/**
 * People the user may see: themselves, and people who belong to or work in
 * the regions of their scope (home region, region scope or an active site
 * assignment there).
 */
export function userScope(user: ScopeUser): Prisma.UserWhereInput | undefined {
  if (user.isGlobal) return undefined;
  const inRegions = { in: user.regionIds };
  return {
    OR: [
      { id: user.id },
      { homeRegionId: inRegions },
      { regionScopes: { some: { regionId: inRegions } } },
      { siteAssignments: { some: { active: true, site: { regionId: inRegions } } } },
    ],
  };
}

/** True when a region is inside the user's region scope (for changes, not just reading). */
export function managesRegion(user: ScopeUser, regionId: string): boolean {
  return user.isGlobal || user.regionIds.includes(regionId);
}

/** Combines a scope filter with other conditions. */
export function within<T extends object>(scope: T | undefined, where: T = {} as T): T {
  return (scope ? { AND: [scope, where] } : where) as T;
}
