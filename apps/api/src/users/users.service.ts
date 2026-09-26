import { Injectable } from '@nestjs/common';
import type { RoleCode } from '../authz/catalog.js';
import { invalid, notFound, rethrowDbError } from '../common/prisma-errors.js';
import { parseInput } from '../common/validation.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RegionScopeInput, RolesInput, UserInput, UserPatch } from './users.schemas.js';

type Tx = Prisma.TransactionClient;

/** Roles whose work is limited to the regions in their scope. */
const SCOPED_ROLES: readonly string[] = ['REGIONAL_MANAGER', 'REGIONAL_SUPERVISOR'];
/** Roles a technician may report to. */
const LINE_MANAGER_ROLES: readonly string[] = ['REGIONAL_SUPERVISOR', 'REGIONAL_MANAGER'];

export interface UserAccess {
  id: string;
  email: string;
  fullName: string;
  isActive: boolean;
  roles: RoleCode[];
  permissions: string[];
  regionIds: string[];
}

/**
 * Users, their roles and their organisational scope. Passwords and sessions
 * are Phase 3; these rules hold for every caller.
 */
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async createUser(input: unknown, actorId: string | null) {
    const data = parseInput(UserInput, input);
    return this.prisma
      .$transaction(async (tx) => {
        const roleIds = await this.roleIds(tx, data.roles);
        this.checkScopeRequired(data.roles, data.regionScopeIds);
        await this.checkRegions(tx, [...data.regionScopeIds, ...(data.homeRegionId ? [data.homeRegionId] : [])]);
        if (data.reportsToId) await this.checkLineManager(tx, data.reportsToId);
        const user = await tx.user.create({
          data: {
            email: data.email,
            fullName: data.fullName,
            phone: data.phone ?? null,
            employeeCode: data.employeeCode || null,
            homeRegionId: data.homeRegionId ?? null,
            reportsToId: data.reportsToId ?? null,
            createdById: actorId,
            updatedById: actorId,
          },
        });
        await tx.userRole.createMany({ data: roleIds.map((roleId) => ({ userId: user.id, roleId, grantedById: actorId })) });
        if (data.regionScopeIds.length) {
          await tx.userRegionScope.createMany({ data: data.regionScopeIds.map((regionId) => ({ userId: user.id, regionId, grantedById: actorId })) });
        }
        return user;
      })
      .catch(rethrowDbError);
  }

  async updateUser(id: string, patch: unknown, actorId: string | null) {
    const data = parseInput(UserPatch, patch);
    await this.requireUser(id);
    return this.prisma
      .$transaction(async (tx) => {
        if (data.homeRegionId) await this.checkRegions(tx, [data.homeRegionId]);
        if (data.reportsToId) {
          if (data.reportsToId === id) throw invalid('INVALID_LINE_MANAGER', 'A user cannot report to themselves.');
          await this.checkLineManager(tx, data.reportsToId);
        }
        return tx.user.update({
          where: { id },
          data: { ...data, employeeCode: data.employeeCode === undefined ? undefined : data.employeeCode || null, updatedById: actorId },
        });
      })
      .catch(rethrowDbError);
  }

  /** Replaces a user's roles. The last active Super Admin keeps that role. */
  async setRoles(userId: string, input: unknown, actorId: string | null) {
    const { roles } = parseInput(RolesInput, input);
    return this.prisma.$transaction(async (tx) => {
      const user = await this.requireUser(userId, tx);
      const current = await this.roleCodes(tx, userId);
      if (current.includes('SUPER_ADMIN') && !roles.includes('SUPER_ADMIN') && user.isActive) await this.keepOneSuperAdmin(tx, userId);
      const scopes = await tx.userRegionScope.findMany({ where: { userId }, select: { regionId: true } });
      this.checkScopeRequired(roles, scopes.map((s) => s.regionId));
      const roleIds = await this.roleIds(tx, roles);
      await tx.userRole.deleteMany({ where: { userId, roleId: { notIn: roleIds } } });
      const have = new Set((await tx.userRole.findMany({ where: { userId }, select: { roleId: true } })).map((r) => r.roleId));
      const add = roleIds.filter((id) => !have.has(id));
      if (add.length) await tx.userRole.createMany({ data: add.map((roleId) => ({ userId, roleId, grantedById: actorId })) });
      await tx.user.update({ where: { id: userId }, data: { updatedById: actorId } });
      return this.accessOf(tx, userId);
    });
  }

  /** Replaces the regions a manager or supervisor works in. */
  async setRegionScopes(userId: string, input: unknown, actorId: string | null) {
    const { regionIds } = parseInput(RegionScopeInput, input);
    return this.prisma.$transaction(async (tx) => {
      await this.requireUser(userId, tx);
      this.checkScopeRequired(await this.roleCodes(tx, userId), regionIds);
      await this.checkRegions(tx, regionIds);
      await tx.userRegionScope.deleteMany({ where: { userId, regionId: { notIn: regionIds } } });
      const have = new Set((await tx.userRegionScope.findMany({ where: { userId }, select: { regionId: true } })).map((r) => r.regionId));
      const add = regionIds.filter((id) => !have.has(id));
      if (add.length) await tx.userRegionScope.createMany({ data: add.map((regionId) => ({ userId, regionId, grantedById: actorId })) });
      return this.accessOf(tx, userId);
    });
  }

  /**
   * Activates or deactivates a user. Deactivation ends the user's active site
   * assignments (history kept) and never removes the last active Super Admin.
   */
  async setActive(userId: string, active: boolean, actorId: string | null) {
    return this.prisma.$transaction(async (tx) => {
      const user = await this.requireUser(userId, tx);
      if (!active && user.isActive) {
        if ((await this.roleCodes(tx, userId)).includes('SUPER_ADMIN')) await this.keepOneSuperAdmin(tx, userId);
        const today = new Date(new Date().toISOString().slice(0, 10));
        const open = await tx.siteAssignment.findMany({ where: { userId, active: true } });
        for (const a of open) {
          await tx.siteAssignment.update({
            where: { id: a.id },
            data: { active: false, endDate: a.startDate > today ? a.startDate : today, endReason: 'User deactivated', endedById: actorId },
          });
        }
      }
      return tx.user.update({ where: { id: userId }, data: { isActive: active, updatedById: actorId } });
    });
  }

  /** Roles, permissions and region scope — what the Phase 3 guards check. */
  async getAccess(userId: string): Promise<UserAccess> {
    return this.accessOf(this.prisma, userId);
  }

  // --- Helpers -------------------------------------------------------------------

  private async accessOf(db: Tx | PrismaService, userId: string): Promise<UserAccess> {
    const user = await db.user.findUnique({
      where: { id: userId },
      include: {
        roles: { include: { role: { include: { permissions: { include: { permission: { select: { code: true } } } } } } } },
        regionScopes: { select: { regionId: true } },
      },
    });
    if (!user) throw notFound('User');
    const permissions = new Set(user.roles.flatMap((r) => r.role.permissions.map((p) => p.permission.code)));
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      isActive: user.isActive,
      roles: user.roles.map((r) => r.role.code as RoleCode).sort(),
      permissions: [...permissions].sort(),
      regionIds: user.regionScopes.map((s) => s.regionId).sort(),
    };
  }

  private async requireUser(id: string, db: Tx | PrismaService = this.prisma) {
    const u = await db.user.findUnique({ where: { id } });
    if (!u) throw notFound('User');
    return u;
  }

  private async roleIds(tx: Tx, codes: readonly string[]) {
    const found = await tx.role.findMany({ where: { code: { in: [...codes] } }, select: { id: true, code: true } });
    const missing = codes.filter((c) => !found.some((f) => f.code === c));
    if (missing.length) throw invalid('UNKNOWN_ROLE', `Unknown role: ${missing.join(', ')}. Run the reference seed.`);
    return found.map((f) => f.id);
  }

  private async roleCodes(tx: Tx, userId: string) {
    return (await tx.userRole.findMany({ where: { userId }, include: { role: { select: { code: true } } } })).map((r) => r.role.code);
  }

  private checkScopeRequired(roles: readonly string[], regionIds: readonly string[]) {
    if (roles.some((r) => SCOPED_ROLES.includes(r)) && regionIds.length === 0) {
      throw invalid('SCOPE_REQUIRED', 'Regional managers and supervisors need at least one region in their scope.');
    }
  }

  private async checkRegions(tx: Tx, ids: readonly string[]) {
    if (!ids.length) return;
    const unique = [...new Set(ids)];
    const count = await tx.region.count({ where: { id: { in: unique } } });
    if (count !== unique.length) throw invalid('INVALID_REFERENCE', 'A region does not exist.');
  }

  private async checkLineManager(tx: Tx, managerId: string) {
    const manager = await tx.user.findUnique({ where: { id: managerId } });
    if (!manager || !manager.isActive) throw invalid('INVALID_LINE_MANAGER', 'The line manager must be an active user.');
    const roles = await this.roleCodes(tx, managerId);
    if (!roles.some((r) => LINE_MANAGER_ROLES.includes(r))) {
      throw invalid('INVALID_LINE_MANAGER', 'The line manager must be a regional supervisor or manager.');
    }
  }

  private async keepOneSuperAdmin(tx: Tx, userId: string) {
    const others = await tx.user.count({
      where: { id: { not: userId }, isActive: true, roles: { some: { role: { code: 'SUPER_ADMIN' } } } },
    });
    if (others === 0) throw invalid('LAST_SUPER_ADMIN', 'This is the last active Super Admin; add another before removing this one.');
  }
}
