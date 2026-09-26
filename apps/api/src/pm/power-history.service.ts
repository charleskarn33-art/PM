import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth-user.js';
import { notFound } from '../common/prisma-errors.js';
import { parseInput } from '../common/validation.js';
import { OrganisationService } from '../organisation/organisation.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toDate } from './dates.js';
import { moduleView } from './mapping.js';

const MODULES = ['generator', 'dc', 'battery', 'solar', 'non-technical', 'earthing'] as const;
type Module = (typeof MODULES)[number];

export const PowerHistoryQuery = z.strictObject({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  /** Only PMs with these statuses (default: every status except cancelled). */
  status: z.enum(['IN_PROGRESS', 'COMPLETED', 'APPROVED', 'REJECTED']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const VISIT = { select: { id: true, status: true, startedAt: true, technician: { select: { id: true, fullName: true } } } } as const;

/**
 * A site's power-module records over time (one per PM visit), newest first.
 * Values are as recorded; calculated values are in their own fields.
 */
@Injectable()
export class PowerHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly org: OrganisationService,
  ) {}

  async history(siteId: string, module: string, query: unknown, caller: AuthUser) {
    if (!MODULES.includes(module as Module)) throw notFound('Module');
    await this.org.getSite(siteId, caller); // scope: "not found" outside it
    const q = parseInput(PowerHistoryQuery, query);
    const where = {
      siteId,
      recordedAt: { ...(q.from ? { gte: toDate(q.from) } : {}), ...(q.to ? { lt: new Date(toDate(q.to).getTime() + 86_400_000) } : {}) },
      visit: q.status ? { status: q.status } : { status: { not: 'CANCELLED' as const } },
    };
    const args = { where, orderBy: { recordedAt: 'desc' as const }, take: q.limit };
    const empty = { generator: null, dc: null, dcPhases: [], battery: null, batteryUnits: [], solar: null, nonTechnical: null, earthing: null };
    switch (module as Module) {
      case 'generator':
        return (await this.prisma.generatorReading.findMany({ ...args, include: { visit: VISIT } })).map(({ visit, ...r }) => ({ ...moduleView({ ...empty, generator: r }).generator, visit }));
      case 'dc':
        return (await this.prisma.dcReading.findMany({ ...args, include: { visit: { select: { ...VISIT.select, dcPhases: { orderBy: { phaseNumber: 'asc' } } } } } })).map(({ visit: { dcPhases, ...visit }, ...r }) => ({
          ...moduleView({ ...empty, dc: r, dcPhases }).dc,
          visit,
        }));
      case 'battery':
        return (await this.prisma.batteryReading.findMany({ ...args, include: { visit: { select: { ...VISIT.select, batteryUnits: { orderBy: { unitNumber: 'asc' } } } } } })).map(
          ({ visit: { batteryUnits, ...visit }, ...r }) => ({ ...moduleView({ ...empty, battery: r, batteryUnits }).battery, visit }),
        );
      case 'solar':
        return (await this.prisma.solarReading.findMany({ ...args, include: { visit: VISIT } })).map(({ visit, ...r }) => ({ ...moduleView({ ...empty, solar: r }).solar, visit }));
      case 'non-technical':
        return (await this.prisma.nonTechnicalObservation.findMany({ ...args, include: { visit: VISIT } })).map(({ visit, ...r }) => ({ ...moduleView({ ...empty, nonTechnical: r }).nonTechnical, visit }));
      case 'earthing':
        return (await this.prisma.earthingReading.findMany({ ...args, include: { visit: VISIT } })).map(({ visit, ...r }) => ({ ...moduleView({ ...empty, earthing: r }).earthing, visit }));
    }
  }
}
