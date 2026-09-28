import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth-user.js';
import { siteScope, within } from '../authz/scope.js';
import { notFound } from '../common/prisma-errors.js';
import { parseInput } from '../common/validation.js';
import { AppConfig } from '../config/app-config.js';
import type { Prisma } from '../generated/prisma/client.js';
import { toDate, toIso, todayIn } from '../pm/dates.js';
import { PrismaService } from '../prisma/prisma.service.js';

const ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');
export const HistoryQuery = z.strictObject({
  from: ISO_DATE.optional(),
  to: ISO_DATE.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

const n = (d: { toString(): string } | null | undefined): number | null => (d == null ? null : Number(d));

/**
 * A site's PM history: every PM visit, newest first, with its result, the
 * failures it raised and its key readings (as recorded on that visit).
 */
@Injectable()
export class PmHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  async history(siteId: string, query: unknown, caller: AuthUser) {
    const q = parseInput(HistoryQuery, query);
    const site = await this.prisma.site.findFirst({
      where: within(siteScope(caller), { id: siteId }),
      select: { id: true, siteCode: true, siteName: true, isDemo: true, region: { select: { id: true, name: true } } },
    });
    if (!site) throw notFound('Site');
    const where: Prisma.PmVisitWhereInput = {
      siteId,
      ...(q.from || q.to ? { startedAt: { ...(q.from ? { gte: toDate(q.from) } : {}), ...(q.to ? { lt: new Date(toDate(q.to).getTime() + 86_400_000) } : {}) } } : {}),
    };
    const [visits, total, statuses] = await Promise.all([
      this.prisma.pmVisit.findMany({
        where,
        orderBy: [{ startedAt: 'desc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          technician: { select: { id: true, fullName: true } },
          template: { select: { name: true, version: true } },
          schedule: { select: { dueDate: true } },
          reviewedBy: { select: { fullName: true } },
          dc: { select: { dcPowerKw: true, rectifierVoltageV: true, loadCurrentA: true } },
          battery: { select: { batteryVoltageV: true, minUnitVoltageV: true } },
          generator: { select: { fuelLevelPct: true, runningHours: true, requiresService: true } },
        },
      }),
      this.prisma.pmVisit.count({ where }),
      this.prisma.pmVisit.groupBy({ by: ['status'], where, _count: { _all: true } }),
    ]);
    return {
      site,
      summary: Object.fromEntries(statuses.map((s) => [s.status, s._count._all])),
      items: visits.map((v) => {
        const due = v.schedule ? toIso(v.schedule.dueDate) : null;
        const finished = v.status === 'COMPLETED' || v.status === 'APPROVED';
        const doneOn = v.completedAt ? todayIn(this.config.orgTimezone, v.completedAt) : null;
        return {
          id: v.id,
          status: v.status,
          startedAt: v.startedAt,
          completedAt: v.completedAt,
          dueDate: due,
          /** Finished on or before the due date (null: not finished or not scheduled). */
          onTime: due && finished && doneOn ? doneOn <= due : null,
          completionPct: Number(v.completionPct),
          failureCount: v.failureCount,
          technician: v.technician,
          template: v.template,
          reviewedBy: v.reviewedBy?.fullName ?? null,
          reviewedAt: v.reviewedAt,
          readings: {
            dcPowerKw: n(v.dc?.dcPowerKw),
            loadCurrentA: n(v.dc?.loadCurrentA),
            rectifierVoltageV: n(v.dc?.rectifierVoltageV),
            batteryVoltageV: n(v.battery?.batteryVoltageV),
            minUnitVoltageV: n(v.battery?.minUnitVoltageV),
            fuelLevelPct: n(v.generator?.fuelLevelPct),
            runningHours: n(v.generator?.runningHours),
            requiresService: v.generator?.requiresService ?? null,
          },
        };
      }),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }
}
