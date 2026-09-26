import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { invalid, notFound } from '../common/prisma-errors.js';
import { parseInput } from '../common/validation.js';
import { AppError } from '../common/http-exception.filter.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

const isoDate = z.iso.date().transform((d) => new Date(`${d}T00:00:00.000Z`));

export const AssignInput = z.strictObject({
  siteId: z.uuid(),
  userId: z.uuid(),
  role: z.enum(['TECHNICIAN', 'SUPERVISOR']),
  startDate: isoDate,
});
export const EndAssignmentInput = z.strictObject({
  endDate: isoDate,
  reason: z.string().trim().max(255).optional(),
});

/** The system role a person needs for each kind of site assignment. */
const REQUIRED_ROLE = { TECHNICIAN: 'TECHNICIAN', SUPERVISOR: 'REGIONAL_SUPERVISOR' } as const;
const DAY = 86_400_000;

/**
 * Who works on which site, over time. Assignments are ended, never deleted.
 * A site has at most one active supervisor (a new one replaces the old one
 * in the same transaction); it may have several active technicians.
 */
@Injectable()
export class AssignmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async assign(input: unknown, actorId: string | null) {
    const data = parseInput(AssignInput, input);
    return this.prisma.$transaction(async (tx) => {
      // Serialise assignment changes per site (e.g. two supervisors assigned at once).
      const locked = await tx.$queryRaw<{ id: string; status: string; region_id: string }[]>`
        SELECT id, status, region_id FROM sites WHERE id = ${data.siteId} FOR UPDATE`;
      const site = locked[0];
      if (!site) throw invalid('INVALID_REFERENCE', 'The site does not exist.');
      if (site.status !== 'ACTIVE') throw invalid('SITE_NOT_ACTIVE', 'Only active sites can be assigned.');

      const user = await tx.user.findUnique({
        where: { id: data.userId },
        include: { roles: { include: { role: { select: { code: true } } } }, regionScopes: { select: { regionId: true } } },
      });
      if (!user) throw invalid('INVALID_REFERENCE', 'The user does not exist.');
      if (!user.isActive) throw invalid('USER_INACTIVE', 'Inactive users cannot be assigned.');
      const needed = REQUIRED_ROLE[data.role];
      if (!user.roles.some((r) => r.role.code === needed)) {
        throw invalid('ROLE_MISMATCH', data.role === 'TECHNICIAN' ? 'Only technicians can be assigned as the site technician.' : 'Only regional supervisors can be assigned as the site supervisor.');
      }
      if (data.role === 'SUPERVISOR' && !user.regionScopes.some((s) => s.regionId === site.region_id)) {
        throw invalid('OUT_OF_SCOPE', "The site's region is not in this supervisor's scope.");
      }

      const duplicate = await tx.siteAssignment.findFirst({ where: { siteId: data.siteId, userId: data.userId, role: data.role, active: true } });
      if (duplicate) throw new AppError(409, 'ALREADY_ASSIGNED', 'This person is already assigned to the site in this role.');

      if (data.role === 'SUPERVISOR') {
        const current = await tx.siteAssignment.findMany({ where: { siteId: data.siteId, role: 'SUPERVISOR', active: true } });
        for (const a of current) {
          if (data.startDate < a.startDate) throw invalid('START_BEFORE_CURRENT', "The new supervisor's start date is before the current supervisor's.");
          const dayBefore = new Date(data.startDate.getTime() - DAY);
          await tx.siteAssignment.update({
            where: { id: a.id },
            data: { active: false, endDate: dayBefore < a.startDate ? a.startDate : dayBefore, endReason: 'Replaced by a new supervisor', endedById: actorId },
          });
        }
      }

      return tx.siteAssignment.create({
        data: { siteId: data.siteId, userId: data.userId, role: data.role, startDate: data.startDate, assignedById: actorId },
      });
    });
  }

  async end(assignmentId: string, input: unknown, actorId: string | null) {
    const data = parseInput(EndAssignmentInput, input);
    const a = await this.prisma.siteAssignment.findUnique({ where: { id: assignmentId } });
    if (!a) throw notFound('Assignment');
    if (!a.active) throw invalid('ALREADY_ENDED', 'This assignment has already ended.');
    if (data.endDate < a.startDate) throw invalid('END_BEFORE_START', 'The end date is before the start date.');
    return this.prisma.siteAssignment.update({
      where: { id: assignmentId },
      data: { active: false, endDate: data.endDate, endReason: data.reason ?? null, endedById: actorId },
    });
  }

  /** Full history for a site, newest first. */
  history(siteId: string) {
    return this.prisma.siteAssignment.findMany({
      where: { siteId },
      orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
      include: { user: { select: { id: true, fullName: true, email: true } } },
    });
  }

  active(where: Prisma.SiteAssignmentWhereInput) {
    return this.prisma.siteAssignment.findMany({ where: { ...where, active: true }, orderBy: { startDate: 'asc' } });
  }
}
