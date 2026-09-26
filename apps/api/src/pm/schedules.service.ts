import { HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth-user.js';
import { managesRegion, siteScope, within } from '../authz/scope.js';
import { AppError } from '../common/http-exception.filter.js';
import { invalid, notFound, rethrowDbError } from '../common/prisma-errors.js';
import { parseInput } from '../common/validation.js';
import { AppConfig } from '../config/app-config.js';
import type { PmStatus, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { daysBetween, MAX_OCCURRENCES, occurrenceDates, toDate, todayIn, toIso } from './dates.js';

type Tx = Prisma.TransactionClient;

const isoDate = z.iso.date();
const frequency = z.enum(['WEEKLY', 'BIWEEKLY', 'MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL', 'AD_HOC']);
const priority = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const notes = z
  .string()
  .trim()
  .max(1000)
  .nullish()
  .transform((v) => (v ? v : null));

export const ScheduleInput = z
  .strictObject({
    siteId: z.uuid(),
    technicianId: z.uuid().nullish(),
    /** The template's code; its ACTIVE version is used. Defaults to the only active template. */
    templateCode: z.string().trim().max(40).optional(),
    frequency: frequency.default('MONTHLY'),
    scheduledDate: isoDate,
    dueDate: isoDate,
    /** Occurrences to create (recurring plans), 1–24; each keeps the same scheduled→due gap. */
    occurrences: z.number().int().min(1).max(MAX_OCCURRENCES).default(1),
    priority: priority.default('MEDIUM'),
    notes,
  })
  .refine((v) => v.dueDate >= v.scheduledDate, { message: 'must not be before the scheduled date', path: ['dueDate'] });

export const SchedulePatch = z.strictObject({
  technicianId: z.uuid().nullish(),
  scheduledDate: isoDate.optional(),
  dueDate: isoDate.optional(),
  priority: priority.optional(),
  notes,
});

export const CancelInput = z.strictObject({ reason: z.string().trim().min(1).max(255) });

const statuses = ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'APPROVED', 'REJECTED', 'OVERDUE', 'CANCELLED'] as const;
export const ScheduleListQuery = z.strictObject({
  siteId: z.uuid().optional(),
  technicianId: z.uuid().optional(),
  status: z.enum(statuses).optional(),
  /** Only the caller's own schedules. */
  mine: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/** Statuses in which a schedule can still be changed or cancelled. */
const OPEN: PmStatus[] = ['SCHEDULED', 'OVERDUE'];

const INCLUDE = {
  site: { select: { id: true, siteCode: true, siteName: true, regionId: true } },
  technician: { select: { id: true, fullName: true } },
  template: { select: { id: true, code: true, name: true, version: true } },
} as const;

/**
 * PM schedules: which site gets which PM, by whom and by when. Supervisors
 * plan PMs for sites in their regions, for technicians assigned to the site.
 */
@Injectable()
export class SchedulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  today(): string {
    return todayIn(this.config.orgTimezone);
  }

  /** Creates one schedule, or one per occurrence of a recurring plan (sharing a series id). */
  async create(input: unknown, caller: AuthUser) {
    const data = parseInput(ScheduleInput, input);
    return this.prisma
      .$transaction(async (tx) => {
        const site = await this.requireManagedSite(tx, data.siteId, caller);
        if (site.status !== 'ACTIVE') throw invalid('SITE_NOT_ACTIVE', 'Only active sites can be scheduled.');
        if (data.technicianId) await this.checkTechnician(tx, data.technicianId, site.id);
        const template = await this.pickTemplate(tx, data.templateCode);
        const gap = daysBetween(data.scheduledDate, data.dueDate);
        const today = this.today();
        const seriesId = data.occurrences > 1 && data.frequency !== 'AD_HOC' ? randomUUID() : null;
        const dates = occurrenceDates(data.frequency, data.scheduledDate, data.occurrences);
        const ids: string[] = [];
        for (const scheduled of dates) {
          const due = toIso(new Date(toDate(scheduled).getTime() + gap * 86_400_000));
          const row = await tx.pmSchedule.create({
            data: {
              siteId: site.id,
              templateId: template.id,
              technicianId: data.technicianId ?? null,
              seriesId,
              frequency: data.frequency,
              scheduledDate: toDate(scheduled),
              dueDate: toDate(due),
              status: due < today ? 'OVERDUE' : 'SCHEDULED',
              priority: data.priority,
              notes: data.notes,
              createdById: caller.id,
              updatedById: caller.id,
            },
          });
          ids.push(row.id);
        }
        return tx.pmSchedule.findMany({ where: { id: { in: ids } }, include: INCLUDE, orderBy: { scheduledDate: 'asc' } });
      })
      .then((rows) => rows.map(view))
      .catch(rethrowDbError);
  }

  async list(query: unknown, caller: AuthUser) {
    const q = parseInput(ScheduleListQuery, query);
    const where = within<Prisma.PmScheduleWhereInput>(siteScope(caller) ? { site: siteScope(caller) } : undefined, {
      AND: [
        q.siteId ? { siteId: q.siteId } : {},
        q.technicianId ? { technicianId: q.technicianId } : {},
        q.mine ? { technicianId: caller.id } : {},
        q.status ? { status: q.status } : {},
        q.from ? { scheduledDate: { gte: toDate(q.from) } } : {},
        q.to ? { scheduledDate: { lte: toDate(q.to) } } : {},
      ],
    });
    const [items, total] = await this.prisma.$transaction([
      this.prisma.pmSchedule.findMany({
        where,
        include: INCLUDE,
        orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.pmSchedule.count({ where }),
    ]);
    return { items: items.map(view), total, page: q.page, pageSize: q.pageSize };
  }

  async get(id: string, caller: AuthUser) {
    const s = await this.prisma.pmSchedule.findFirst({
      where: within<Prisma.PmScheduleWhereInput>(siteScope(caller) ? { site: siteScope(caller) } : undefined, { id }),
      include: { ...INCLUDE, visits: { select: { id: true, status: true, startedAt: true, completedAt: true }, orderBy: { startedAt: 'desc' } } },
    });
    if (!s) throw notFound('Schedule');
    return view(s);
  }

  async update(id: string, patch: unknown, caller: AuthUser) {
    const data = parseInput(SchedulePatch, patch);
    return this.prisma
      .$transaction(async (tx) => {
        const s = await this.requireManagedSchedule(tx, id, caller);
        if (!OPEN.includes(s.status)) throw invalid('SCHEDULE_NOT_OPEN', 'Only a scheduled or overdue PM can be changed.');
        if (data.technicianId) await this.checkTechnician(tx, data.technicianId, s.siteId);
        const scheduled = data.scheduledDate ?? toIso(s.scheduledDate);
        const due = data.dueDate ?? toIso(s.dueDate);
        if (due < scheduled) throw invalid('VALIDATION_FAILED', 'The request contains invalid values.', [{ path: 'dueDate', message: 'must not be before the scheduled date' }]);
        return tx.pmSchedule.update({
          where: { id },
          data: {
            technicianId: data.technicianId === undefined ? undefined : data.technicianId,
            scheduledDate: toDate(scheduled),
            dueDate: toDate(due),
            status: due < this.today() ? 'OVERDUE' : 'SCHEDULED',
            priority: data.priority,
            notes: data.notes === undefined ? undefined : data.notes,
            updatedById: caller.id,
          },
          include: INCLUDE,
        });
      })
      .then(view)
      .catch(rethrowDbError);
  }

  async cancel(id: string, input: unknown, caller: AuthUser) {
    const { reason } = parseInput(CancelInput, input);
    return this.prisma.$transaction(async (tx) => {
      const s = await this.requireManagedSchedule(tx, id, caller);
      if (!OPEN.includes(s.status)) throw invalid('SCHEDULE_NOT_OPEN', 'Only a scheduled or overdue PM can be cancelled.');
      return view(await tx.pmSchedule.update({ where: { id }, data: { status: 'CANCELLED', cancelReason: reason, updatedById: caller.id }, include: INCLUDE }));
    });
  }

  /** SCHEDULED past its due date → OVERDUE. Returns the number of schedules changed. */
  async markOverdue(today = this.today()): Promise<number> {
    const { count } = await this.prisma.pmSchedule.updateMany({ where: { status: 'SCHEDULED', dueDate: { lt: toDate(today) } }, data: { status: 'OVERDUE' } });
    return count;
  }

  // --- Helpers -------------------------------------------------------------------

  private async requireManagedSite(tx: Tx, siteId: string, caller: AuthUser) {
    const site = await tx.site.findUnique({ where: { id: siteId }, select: { id: true, regionId: true, status: true } });
    if (!site || !managesRegion(caller, site.regionId)) throw invalid('INVALID_REFERENCE', 'The site does not exist.');
    return site;
  }

  /** The schedule, locked, if it is in the caller's regions (otherwise "not found"). */
  private async requireManagedSchedule(tx: Tx, id: string, caller: AuthUser) {
    await tx.$queryRaw`SELECT id FROM pm_schedules WHERE id = ${id} FOR UPDATE`;
    const s = await tx.pmSchedule.findUnique({ where: { id }, include: { site: { select: { regionId: true } } } });
    if (!s || !managesRegion(caller, s.site.regionId)) throw notFound('Schedule');
    return s;
  }

  /** The technician must be an active technician assigned to the site. */
  private async checkTechnician(tx: Tx, userId: string, siteId: string) {
    const user = await tx.user.findUnique({ where: { id: userId }, include: { roles: { include: { role: { select: { code: true } } } } } });
    if (!user) throw invalid('INVALID_REFERENCE', 'The technician does not exist.');
    if (!user.isActive) throw invalid('USER_INACTIVE', 'Inactive users cannot be scheduled.');
    if (!user.roles.some((r) => r.role.code === 'TECHNICIAN')) throw invalid('ROLE_MISMATCH', 'Only technicians can be scheduled for PM.');
    const assigned = await tx.siteAssignment.count({ where: { siteId, userId, role: 'TECHNICIAN', active: true } });
    if (!assigned) throw invalid('NOT_ASSIGNED', 'The technician is not assigned to this site.');
  }

  private async pickTemplate(tx: Tx, code: string | undefined) {
    const active = await tx.pmTemplate.findMany({ where: { status: 'ACTIVE', ...(code ? { code: code.toUpperCase() } : {}) } });
    if (active.length === 1) return active[0]!;
    if (code || active.length === 0) throw invalid('NO_ACTIVE_TEMPLATE', code ? `Template ${code} has no active version.` : 'There is no active PM template.');
    throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'TEMPLATE_REQUIRED', 'Several templates are active: give the template code.');
  }
}

type Row = Prisma.PmScheduleGetPayload<{ include: typeof INCLUDE }>;
function view<T extends Row>(s: T) {
  return { ...s, scheduledDate: toIso(s.scheduledDate), dueDate: toIso(s.dueDate) };
}
