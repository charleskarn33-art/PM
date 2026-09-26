import type { PrismaClient } from '../generated/prisma/client.js';
import { PERMISSIONS, SYSTEM_ROLES, type PermissionCode } from '../authz/catalog.js';

export interface ReferenceSeedResult {
  permissions: number;
  roles: number;
  grantsAdded: number;
  grantsRemoved: number;
  obsoletePermissions: string[];
}

/**
 * Writes the permission catalogue and the system roles with their
 * permissions. Idempotent: safe to run on every deployment, in every
 * environment (this is configuration, not demo data).
 */
export async function seedReferenceData(prisma: PrismaClient): Promise<ReferenceSeedResult> {
  return prisma.$transaction(async (tx) => {
    for (const [code, description] of Object.entries(PERMISSIONS)) {
      await tx.permission.upsert({ where: { code }, create: { code, description }, update: { description } });
    }
    const permissionIds = new Map((await tx.permission.findMany({ select: { id: true, code: true } })).map((p) => [p.code, p.id]));

    let grantsAdded = 0;
    let grantsRemoved = 0;
    let order = 0;
    for (const [code, def] of Object.entries(SYSTEM_ROLES)) {
      order += 1;
      const role = await tx.role.upsert({
        where: { code },
        create: { code, name: def.name, description: def.description, isSystem: true, sortOrder: order },
        update: { name: def.name, description: def.description, isSystem: true, sortOrder: order },
      });
      const wanted = new Set<string>(def.permissions.map((p: PermissionCode) => permissionIds.get(p)!));
      const current = await tx.rolePermission.findMany({ where: { roleId: role.id }, select: { permissionId: true } });
      const have = new Set(current.map((c) => c.permissionId));
      const add = [...wanted].filter((id) => !have.has(id));
      const remove = [...have].filter((id) => !wanted.has(id));
      if (add.length) await tx.rolePermission.createMany({ data: add.map((permissionId) => ({ roleId: role.id, permissionId })) });
      if (remove.length) await tx.rolePermission.deleteMany({ where: { roleId: role.id, permissionId: { in: remove } } });
      grantsAdded += add.length;
      grantsRemoved += remove.length;
    }

    const obsoletePermissions = [...permissionIds.keys()].filter((code) => !(code in PERMISSIONS));
    return {
      permissions: Object.keys(PERMISSIONS).length,
      roles: Object.keys(SYSTEM_ROLES).length,
      grantsAdded,
      grantsRemoved,
      obsoletePermissions,
    };
  });
}
