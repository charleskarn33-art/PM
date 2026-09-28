import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth-user.js';
import { siteScope, within } from '../authz/scope.js';
import { notFound } from '../common/prisma-errors.js';
import { parseInput } from '../common/validation.js';
import { AppConfig } from '../config/app-config.js';
import { actionNumber, failureNumber } from '../failures/failure-rules.js';
import type { Prisma } from '../generated/prisma/client.js';
import { toDate, toIso, todayIn } from '../pm/dates.js';
import { SiteListQuery } from '../organisation/organisation.schemas.js';
import { siteListWhere } from '../organisation/organisation.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BOM, csvRow, type Cell } from './csv.js';

const BATCH = 500;
const DAY_MS = 86_400_000;
const ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');
const Common = { siteId: z.uuid().optional(), regionId: z.uuid().optional(), from: ISO_DATE.optional(), to: ISO_DATE.optional() };
const PM_STATUS = z.enum(['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'APPROVED', 'REJECTED', 'OVERDUE', 'CANCELLED']);

export const VisitsExport = z.strictObject({ ...Common, status: PM_STATUS.optional(), technicianId: z.uuid().optional() });
export const SchedulesExport = z.strictObject({ ...Common, status: PM_STATUS.optional(), technicianId: z.uuid().optional() });
export const FailuresExport = z.strictObject({
  ...Common,
  status: z.enum(['active', 'OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'VERIFIED', 'CLOSED']).optional(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  category: z.enum(['GENERATOR', 'DC_SYSTEM', 'BATTERY', 'SOLAR', 'NON_TECHNICAL', 'EARTHING', 'OTHER']).optional(),
  source: z.enum(['PM_CHECKLIST', 'MANUAL']).optional(),
  visitId: z.uuid().optional(),
  /** Title, or a number such as FL-000012 (as the failure list). */
  q: z.string().trim().max(100).optional(),
});
export const ActionsExport = z.strictObject({
  ...Common,
  status: z.enum(['active', 'OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED', 'CLOSED']).optional(),
  assignedToId: z.uuid().optional(),
  /** `me`: assigned to the caller (as the list's "Assigned to me"). */
  assignedTo: z.literal('me').optional(),
  /** Assigned or in progress and past the due date. */
  overdue: z.literal('true').optional(),
});
export const ReadingsExport = z.strictObject({ ...Common, module: z.enum(['generator', 'dc', 'battery']) });

export const DATASETS = ['visits', 'schedules', 'failures', 'corrective-actions', 'sites', 'readings'] as const;
export type Dataset = (typeof DATASETS)[number];

/** Rows of a model in id order, a batch at a time (no row limit, bounded memory). */
export async function* batched<T extends { id: string }>(fetch: (page: { take: number; skip?: number; cursor?: { id: string }; orderBy: { id: 'asc' } }) => Promise<T[]>, size = BATCH) {
  let cursor: string | undefined;
  for (;;) {
    const rows = await fetch({ take: size, orderBy: { id: 'asc' }, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}) });
    yield* rows;
    if (rows.length < size) return;
    cursor = rows.at(-1)!.id;
  }
}

/**
 * CSV exports of the operational lists, with the same kinds of filters as the
 * lists and always within the caller's scope. Rows stream as they are read.
 */
@Injectable()
export class ExportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  /** Date and time in the organisation's time zone, as spreadsheets read it (YYYY-MM-DD HH:mm). */
  private dt = (d: Date | null | undefined) => (d ? `${todayIn(this.config.orgTimezone, d)} ${new Intl.DateTimeFormat('en-GB', { timeZone: this.config.orgTimezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d)}` : null);
  private day = (d: Date | null | undefined) => (d ? toIso(d) : null);

  private site(caller: AuthUser, q: { siteId?: string; regionId?: string }): Prisma.SiteWhereInput {
    return within(siteScope(caller), { ...(q.siteId ? { id: q.siteId } : {}), ...(q.regionId ? { regionId: q.regionId } : {}) });
  }

  /** `[from, to]` dates as an instant range (whole days, UTC dates as the lists use). */
  private span(q: { from?: string; to?: string }) {
    return q.from || q.to ? { ...(q.from ? { gte: toDate(q.from) } : {}), ...(q.to ? { lt: new Date(toDate(q.to).getTime() + DAY_MS) } : {}) } : undefined;
  }

  /** The file name and the CSV text as it is produced. */
  export(dataset: string, query: unknown, caller: AuthUser): { fileName: string; body: AsyncGenerator<string> } {
    if (!(DATASETS as readonly string[]).includes(dataset)) throw notFound('Export');
    const d = dataset as Dataset;
    const stamp = todayIn(this.config.orgTimezone);
    const gen = (() => {
      switch (d) {
        case 'visits':
          return this.visits(parseInput(VisitsExport, query), caller);
        case 'schedules':
          return this.schedules(parseInput(SchedulesExport, query), caller);
        case 'failures':
          return this.failures(parseInput(FailuresExport, query), caller);
        case 'corrective-actions':
          return this.actions(parseInput(ActionsExport, query), caller);
        case 'sites':
          return this.sites(parseInput(SiteListQuery, query), caller);
        case 'readings':
          return this.readings(parseInput(ReadingsExport, query), caller);
      }
    })();
    const suffix = d === 'readings' ? `-${(query as { module: string }).module}` : '';
    async function* withHeader() {
      let first = true;
      for await (const row of gen) {
        yield first ? BOM + csvRow(row) : csvRow(row);
        first = false;
      }
    }
    return { fileName: `${d}${suffix}-${stamp}.csv`, body: withHeader() };
  }

  /** PM visits with their key readings (DC load, batteries, generator) — also the PM history of a site. */
  private async *visits(q: z.infer<typeof VisitsExport>, caller: AuthUser): AsyncGenerator<Cell[]> {
    yield [
      'Visit ID', 'Site code', 'Site name', 'Region', 'Technician', 'Checklist', 'Version', 'Status', 'Started', 'Completed', 'Due date', 'On time',
      'Checklist completion %', 'Failures', 'Reviewed by', 'Reviewed at', 'Location at start', 'Distance from site (m)',
      'DC power (kW)', 'Load current (A)', 'Rectifier voltage (V)', 'Battery bank voltage (V)', 'Lowest battery (V)', 'Fuel level (%)', 'Running hours', 'Needs service', 'Demo',
    ];
    const where: Prisma.PmVisitWhereInput = {
      site: this.site(caller, q),
      ...(q.status ? { status: q.status } : {}),
      ...(q.technicianId ? { technicianId: q.technicianId } : {}),
      ...(this.span(q) ? { startedAt: this.span(q) } : {}),
    };
    const rows = batched((page) =>
      this.prisma.pmVisit.findMany({
        ...page,
        where,
        include: {
          site: { select: { siteCode: true, siteName: true, region: { select: { name: true } } } },
          technician: { select: { fullName: true } },
          template: { select: { name: true, version: true } },
          schedule: { select: { dueDate: true } },
          reviewedBy: { select: { fullName: true } },
          dc: { select: { dcPowerKw: true, loadCurrentA: true, rectifierVoltageV: true } },
          battery: { select: { batteryVoltageV: true, minUnitVoltageV: true } },
          generator: { select: { fuelLevelPct: true, runningHours: true, requiresService: true } },
        },
      }),
    );
    for await (const v of rows) {
      const due = v.schedule ? toIso(v.schedule.dueDate) : null;
      const doneOn = v.completedAt ? todayIn(this.config.orgTimezone, v.completedAt) : null;
      const finished = v.status === 'COMPLETED' || v.status === 'APPROVED';
      yield [
        v.id, v.site.siteCode, v.site.siteName, v.site.region.name, v.technician.fullName, v.template.name, v.template.version, v.status,
        this.dt(v.startedAt), this.dt(v.completedAt), due, due && doneOn && finished ? doneOn <= due : null,
        Number(v.completionPct), v.failureCount, v.reviewedBy?.fullName, this.dt(v.reviewedAt), v.gpsStatus, n(v.gpsDistanceM),
        n(v.dc?.dcPowerKw), n(v.dc?.loadCurrentA), n(v.dc?.rectifierVoltageV), n(v.battery?.batteryVoltageV), n(v.battery?.minUnitVoltageV),
        n(v.generator?.fuelLevelPct), n(v.generator?.runningHours), v.generator?.requiresService, v.isDemo,
      ];
    }
  }

  private async *schedules(q: z.infer<typeof SchedulesExport>, caller: AuthUser): AsyncGenerator<Cell[]> {
    yield ['Schedule ID', 'Site code', 'Site name', 'Region', 'Technician', 'Frequency', 'Scheduled', 'Due', 'Status', 'Priority', 'Notes', 'Cancel reason', 'Demo'];
    const where: Prisma.PmScheduleWhereInput = {
      site: this.site(caller, q),
      ...(q.status ? { status: q.status } : {}),
      ...(q.technicianId ? { technicianId: q.technicianId } : {}),
      // Scheduled date, as the schedule list filters.
      ...(q.from || q.to ? { scheduledDate: { ...(q.from ? { gte: toDate(q.from) } : {}), ...(q.to ? { lte: toDate(q.to) } : {}) } } : {}),
    };
    const rows = batched((page) =>
      this.prisma.pmSchedule.findMany({
        ...page,
        where,
        include: { site: { select: { siteCode: true, siteName: true, region: { select: { name: true } } } }, technician: { select: { fullName: true } } },
      }),
    );
    for await (const s of rows)
      yield [s.id, s.site.siteCode, s.site.siteName, s.site.region.name, s.technician?.fullName, s.frequency, this.day(s.scheduledDate), this.day(s.dueDate), s.status, s.priority, s.notes, s.cancelReason, s.isDemo];
  }

  private async *failures(q: z.infer<typeof FailuresExport>, caller: AuthUser): AsyncGenerator<Cell[]> {
    yield ['Number', 'Site code', 'Site name', 'Region', 'Source', 'Section', 'Category', 'Severity', 'Title', 'Description', 'Status', 'Detected', 'Resolved', 'Verified', 'Closed', 'Close note', 'Visit ID', 'Demo'];
    const where: Prisma.FailureWhereInput = {
      site: this.site(caller, q),
      ...(q.status === 'active' ? { status: { not: 'CLOSED' } } : q.status ? { status: q.status } : {}),
      ...(q.severity ? { severity: q.severity } : {}),
      ...(q.category ? { category: q.category } : {}),
      ...(q.source ? { source: q.source } : {}),
      ...(q.visitId ? { visitId: q.visitId } : {}),
      ...(q.q ? (/^(?:FL-)?0*(\d{1,9})$/i.test(q.q) ? { number: Number(/(\d{1,9})$/.exec(q.q)![1]) } : { title: { contains: q.q } }) : {}),
      ...(this.span(q) ? { detectedAt: this.span(q) } : {}),
    };
    const rows = batched((page) => this.prisma.failure.findMany({ ...page, where, include: { site: { select: { siteCode: true, siteName: true, region: { select: { name: true } } } } } }));
    for await (const f of rows)
      yield [
        failureNumber(f.number), f.site.siteCode, f.site.siteName, f.site.region.name, f.source, f.sectionCode, f.category, f.severity, f.title, f.description, f.status,
        this.dt(f.detectedAt), this.dt(f.resolvedAt), this.dt(f.verifiedAt), this.dt(f.closedAt), f.closeNote, f.visitId, f.isDemo,
      ];
  }

  private async *actions(q: z.infer<typeof ActionsExport>, caller: AuthUser): AsyncGenerator<Cell[]> {
    yield ['Number', 'Failure', 'Site code', 'Site name', 'Region', 'Title', 'Priority', 'Status', 'Assigned to', 'Due date', 'Overdue', 'Created', 'Started', 'Completed', 'Completion note', 'Verified', 'Closed', 'Demo'];
    const today = todayIn(this.config.orgTimezone);
    const where: Prisma.CorrectiveActionWhereInput = {
      site: this.site(caller, q),
      ...(q.status === 'active' ? { status: { in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED'] } } : q.status ? { status: q.status } : {}),
      ...(q.assignedToId ? { assignedToId: q.assignedToId } : {}),
      ...(q.assignedTo === 'me' ? { assignedToId: caller.id } : {}),
      ...(this.span(q) ? { createdAt: this.span(q) } : {}),
    };
    if (q.overdue) where.AND = [{ status: { in: ['ASSIGNED', 'IN_PROGRESS'] }, dueDate: { lt: toDate(today) } }];
    const rows = batched((page) =>
      this.prisma.correctiveAction.findMany({
        ...page,
        where,
        include: { failure: { select: { number: true } }, site: { select: { siteCode: true, siteName: true, region: { select: { name: true } } } }, assignedTo: { select: { fullName: true } } },
      }),
    );
    for await (const a of rows) {
      const due = this.day(a.dueDate);
      yield [
        actionNumber(a.number), failureNumber(a.failure.number), a.site.siteCode, a.site.siteName, a.site.region.name, a.title, a.priority, a.status, a.assignedTo?.fullName, due,
        due != null && (a.status === 'ASSIGNED' || a.status === 'IN_PROGRESS') && due < today,
        this.dt(a.createdAt), this.dt(a.startedAt), this.dt(a.completedAt), a.completionNote, this.dt(a.verifiedAt), this.dt(a.closedAt), a.isDemo,
      ];
    }
  }

  /** Sites with the same filters as the site list. */
  private async *sites(q: SiteListQuery, caller: AuthUser): AsyncGenerator<Cell[]> {
    yield ['Site code', 'Site name', 'Region', 'Cluster', 'County', 'Status', 'Type', 'Latitude', 'Longitude', 'Generator', 'Solar', 'Grid', 'Batteries', 'Technicians', 'Supervisors', 'Demo'];
    const where = siteListWhere(q, caller);
    const rows = batched((page) =>
      this.prisma.site.findMany({
        ...page,
        where,
        include: {
          region: { select: { name: true } },
          cluster: { select: { name: true } },
          county: { select: { name: true } },
          assignments: { where: { active: true }, select: { role: true, user: { select: { fullName: true } } } },
        },
      }),
    );
    for await (const s of rows) {
      const people = (role: string) => s.assignments.filter((a) => a.role === role).map((a) => a.user.fullName).join('; ');
      yield [
        s.siteCode, s.siteName, s.region.name, s.cluster?.name, s.county?.name, s.status, s.siteType, n(s.latitude), n(s.longitude),
        s.generatorAvailable, s.solarAvailable, s.gridAvailable, s.batteryUnitCount, people('TECHNICIAN'), people('SUPERVISOR'), s.isDemo,
      ];
    }
  }

  /** Power readings from completed or approved PMs only (as in Analytics). */
  private async *readings(q: z.infer<typeof ReadingsExport>, caller: AuthUser): AsyncGenerator<Cell[]> {
    const base = { site: this.site(caller, q), visit: { status: { in: ['COMPLETED' as const, 'APPROVED' as const] } }, ...(this.span(q) ? { recordedAt: this.span(q) } : {}) };
    const include = { site: { select: { siteCode: true, siteName: true, region: { select: { name: true } } } }, visit: { select: { status: true } } } as const;
    const lead = (r: { visitId: string; recordedAt: Date; site: { siteCode: string; siteName: string; region: { name: string } }; visit: { status: string } }): Cell[] => [
      r.site.siteCode, r.site.siteName, r.site.region.name, this.dt(r.recordedAt), r.visitId, r.visit.status,
    ];
    const head = ['Site code', 'Site name', 'Region', 'Recorded', 'Visit ID', 'Visit status'];
    // Readings are keyed by visit; batch on it.
    const page = <T extends { visitId: string }>(fetch: (p: { take: number; skip?: number; cursor?: { visitId: string }; orderBy: { visitId: 'asc' } }) => Promise<T[]>) =>
      batched<T & { id: string }>(async (p) => (await fetch({ take: p.take, orderBy: { visitId: 'asc' }, ...(p.cursor ? { skip: 1, cursor: { visitId: p.cursor.id } } : {}) })).map((r) => ({ ...r, id: r.visitId })));
    if (q.module === 'dc') {
      yield [...head, 'Rectifier voltage (V)', 'Load current (A)', 'DC power (kW)', 'Total phase current (A)', 'Phases recorded', 'Rectifier modules', 'DC modules installed', 'DC modules operational', 'Controller'];
      for await (const r of page((p) => this.prisma.dcReading.findMany({ ...p, where: base, include })))
        yield [...lead(r), n(r.rectifierVoltageV), n(r.loadCurrentA), n(r.dcPowerKw), n(r.totalPhaseCurrentA), r.phasesRecorded, r.rectifierModuleCount, r.dcModulesInstalled, r.dcModulesOperational, r.controllerModel];
    } else if (q.module === 'battery') {
      yield [...head, 'Bank voltage (V)', 'Capacity (Ah)', 'Strings', 'Batteries recorded', 'Lowest battery (V)', 'Highest battery (V)', 'Physical damage', 'Water top-up needed'];
      for await (const r of page((p) => this.prisma.batteryReading.findMany({ ...p, where: base, include })))
        yield [...lead(r), n(r.batteryVoltageV), n(r.capacityAh), r.stringCount, r.unitsRecorded, n(r.minUnitVoltageV), n(r.maxUnitVoltageV), r.physicalDamageFound, r.waterTopUpRequired];
    } else {
      yield [...head, 'Running hours', 'Fuel level (%)', 'Generator (kVA)', 'Oil pressure', 'Engine oil changed', 'Fuel filter changed', 'Oil filter changed', 'Needs service'];
      for await (const r of page((p) => this.prisma.generatorReading.findMany({ ...p, where: base, include })))
        yield [...lead(r), n(r.runningHours), n(r.fuelLevelPct), n(r.generatorKva), r.oilPressure, r.engineOilChanged, r.fuelFilterChanged, r.oilFilterChanged, r.requiresService];
    }
  }
}

const n = (d: { toString(): string } | null | undefined): number | null => (d == null ? null : Number(d));
