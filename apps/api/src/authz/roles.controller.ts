import { Controller, Get } from '@nestjs/common';
import { RequirePermissions } from './decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** The roles and the permissions each one holds (read-only: roles are maintained by the seed). */
@Controller('roles')
export class RolesController {
  constructor(private readonly prisma: PrismaService) {}

  @RequirePermissions('roles.read')
  @Get()
  async list() {
    const roles = await this.prisma.role.findMany({
      orderBy: { sortOrder: 'asc' },
      select: { code: true, name: true, description: true, isSystem: true, permissions: { select: { permission: { select: { code: true } } } } },
    });
    return roles.map(({ permissions, ...r }) => ({ ...r, permissions: permissions.map((p) => p.permission.code).sort() }));
  }

  @RequirePermissions('roles.read')
  @Get('permissions')
  permissions() {
    return this.prisma.permission.findMany({ orderBy: { code: 'asc' }, select: { code: true, description: true } });
  }
}
