import { HttpStatus, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth-user.js';
import { siteScope, within } from '../authz/scope.js';
import { AppError } from '../common/http-exception.filter.js';
import { parseInput } from '../common/validation.js';
import { AppConfig } from '../config/app-config.js';
import type { Prisma } from '../generated/prisma/client.js';
import { toDate, todayIn } from '../pm/dates.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import {
  AnalyticsRangeError,
  batteryFlags,
  belowTarget,
  dcFlags,
  generatorFlags,
  mean,
  median,
  monthIn,
  num,
  pct,
  resolveRange,
  type Month,
  type PowerFlag,
  type Thresholds,
} from './analytics-rules.js';

const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM.');
const Range = { from: MONTH.optional(), to: MONTH.optional(), regionId: z.uuid().optional(), countyId: z.uuid().optional() };

export const CompletionQuery = z.strictObject({ ...Range, by: z.enum(['region', 'county', 'technician']).default('region') });
export const PowerQuery = z.strictObject({ ...Range, siteId: z.uuid().optional() });
export const FailuresQuery = z.strictObject(Range);

/** Only work a technician finished (and not sent back) counts. */
const DONE = ['COMPLETED', 'APPROVED'] as const;
const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
const CATEGORIES = ['GENERATOR', 'DC_SYSTEM', 'BATTERY', 'SOLAR', 'NON_TECHNICAL', 'EARTHING', 'OTHER'] as const;
const DAY_MS = 86_400_000;
const TOP = 10;

const SITE = { select: { id: true, siteCode: true, siteName: true, isDemo: true, region: { select: { id: true, name: true } } } } as const;

interface Counts {
  due: number;
  completed: number;
  onTime: number;
  late: number;
  overdue: number;
  open: number;
}
const zero = (): Counts => ({ due: 0, completed: 0, onTime: 0, late: 0, overdue: 0, open: 0 });

/**
 * PM completion, power-system readings and failure trends, counted from the
 * database within the caller's scope. Readings come only from PM visits a
 * technician completed (or a supervisor approved); flags are raised only
 * against thresholds an administrator configured.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly settings: SettingsService,
  ) {}

  private range(q: { from?: Month; to?: Month }) {
    try {
      return resolveRange(q, todayIn(this.config.orgTimezone).slice(0, 7));
    } catch (e) {
      if (e instanceof AnalyticsRangeError) throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_FAILED', e.message, [{ path: 'from', message: e.message }]);
      throw e;
    }
  }

  /**
   * Instants that cover the months in any time zone (a day either side);
   * rows are then placed in months by the organisation's time zone.
   */
  private instants(r: { from: Month; to: Month; months: Month[] }) {
    const start = new Date(toDate(`${r.from}-01`).getTime() - DAY_MS);
    const [y, m] = r.to.split('-').map(Number) as [number, number];
    const end = new Date(Date.UTC(y, m, 1) + DAY_MS);
    return { gte: start, lt: end };
  }

  private month = (at: Date) => monthIn(this.config.orgTimezone, at);

  private siteWhere(caller: AuthUser, q: { regionId?: string; countyId?: string; siteId?: string }): Prisma.SiteWhereInput {
    return within(siteScope(caller), {
      ...(q.regionId ? { regionId: q.regionId } : {}),
      ...(q.countyId ? { countyId: q.countyId } : {}),
      ...(q.siteId ? { id: q.siteId } : {}),
    });
  }

  private thresholds(): Promise<Thresholds> {
    return this.settings.get('thresholds');
  }

  /**
   * PM completion for schedules due in the period, grouped by region, county
   * or the technician the PM was assigned to, with a monthly trend.
   * Completed: the schedule is completed or approved. On time: its finished
   * visit was completed on or before the due date (organisation time zone).
   * Overdue: not completed and past its due date. Cancelled PMs are left out.
   */
  async completion(query: unknown, caller: AuthUser) {
    const q = parseInput(CompletionQuery, query);
    const r = this.range(q);
    const today = todayIn(this.config.orgTimezone);
    const [y, m] = r.to.split('-').map(Number) as [number, number];
    const [schedules, thresholds] = await Promise.all([
      this.prisma.pmSchedule.findMany({
        where: {
          site: this.siteWhere(caller, q),
          status: { not: 'CANCELLED' },
          dueDate: { gte: toDate(`${r.from}-01`), lt: new Date(Date.UTC(y, m, 1)) },
        },
        select: {
          dueDate: true,
          status: true,
          technicianId: true,
          site: { select: { regionId: true, countyId: true } },
          visits: { where: { status: { in: [...DONE] } }, select: { completedAt: true }, orderBy: { completedAt: 'asc' }, take: 1 },
        },
      }),
      this.thresholds(),
    ]);

    const groups = new Map<string, Counts>();
    const trend = new Map(r.months.map((mo) => [mo, zero()]));
    for (const s of schedules) {
      const due = s.dueDate.toISOString().slice(0, 10);
      const key = (q.by === 'region' ? s.site.regionId : q.by === 'county' ? s.site.countyId : s.technicianId) ?? '';
      const g = groups.get(key) ?? zero();
      groups.set(key, g);
      const t = trend.get(due.slice(0, 7));
      for (const c of t ? [g, t] : [g]) {
        c.due++;
        if (DONE.includes(s.status as (typeof DONE)[number])) {
          c.completed++;
          const at = s.visits[0]?.completedAt;
          const doneOn = at ? todayIn(this.config.orgTimezone, at) : null;
          if (doneOn && doneOn <= due) c.onTime++;
          else c.late++;
        } else if (s.status === 'OVERDUE' || due < today) c.overdue++;
        else c.open++;
      }
    }

    const ids = [...groups.keys()].filter(Boolean);
    const names = new Map<string, { name: string; region?: string | null }>();
    if (q.by === 'region') for (const g of await this.prisma.region.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })) names.set(g.id, { name: g.name });
    if (q.by === 'county')
      for (const g of await this.prisma.county.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, cluster: { select: { region: { select: { name: true } } } } } }))
        names.set(g.id, { name: g.name, region: g.cluster.region.name });
    if (q.by === 'technician') for (const g of await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } })) names.set(g.id, { name: g.fullName });

    const withRates = (c: Counts) => {
      const ratePct = pct(c.completed, c.due);
      return { ...c, ratePct, onTimePct: pct(c.onTime, c.due), belowTarget: belowTarget(ratePct, thresholds) };
    };
    const total = zero();
    for (const c of groups.values()) for (const k of Object.keys(total) as (keyof Counts)[]) total[k] += c[k];
    const unnamed = q.by === 'technician' ? 'Unassigned' : q.by === 'county' ? 'No county' : 'Unknown';

    return {
      range: r,
      by: q.by,
      targetPct: thresholds.completionTargetPct,
      total: withRates(total),
      groups: [...groups.entries()]
        .map(([id, c]) => ({ id: id || null, name: names.get(id)?.name ?? unnamed, region: names.get(id)?.region ?? undefined, ...withRates(c) }))
        .sort((a, b) => (a.ratePct ?? -1) - (b.ratePct ?? -1) || b.due - a.due || a.name.localeCompare(b.name)),
      trend: [...trend.entries()].map(([month, c]) => ({ month, ...withRates(c) })),
    };
  }

  /**
   * DC load, battery and generator readings from finished PM visits in the
   * period: each site's latest reading (with any threshold flags) and
   * monthly averages.
   */
  async power(query: unknown, caller: AuthUser) {
    const q = parseInput(PowerQuery, query);
    const r = this.range(q);
    const inMonths = new Set(r.months);
    const where = { recordedAt: this.instants(r), visit: { status: { in: [...DONE] } }, site: this.siteWhere(caller, q) };
    const [dcRows, batteryRows, generatorRows, t] = await Promise.all([
      this.prisma.dcReading.findMany({
        where,
        orderBy: { recordedAt: 'desc' },
        select: { visitId: true, recordedAt: true, dcPowerKw: true, loadCurrentA: true, rectifierVoltageV: true, totalPhaseCurrentA: true, site: SITE },
      }),
      this.prisma.batteryReading.findMany({
        where,
        orderBy: { recordedAt: 'desc' },
        select: { visitId: true, recordedAt: true, batteryVoltageV: true, minUnitVoltageV: true, maxUnitVoltageV: true, unitsRecorded: true, site: SITE },
      }),
      this.prisma.generatorReading.findMany({
        where,
        orderBy: { recordedAt: 'desc' },
        select: { visitId: true, recordedAt: true, runningHours: true, fuelLevelPct: true, generatorKva: true, requiresService: true, oilPressure: true, site: SITE },
      }),
      this.thresholds(),
    ]);

    const dc = dcRows
      .map((x) => ({
        visitId: x.visitId,
        recordedAt: x.recordedAt,
        month: this.month(x.recordedAt),
        site: x.site,
        dcPowerKw: num(x.dcPowerKw),
        loadCurrentA: num(x.loadCurrentA),
        rectifierVoltageV: num(x.rectifierVoltageV),
        totalPhaseCurrentA: num(x.totalPhaseCurrentA),
      }))
      .filter((x) => inMonths.has(x.month));
    const battery = batteryRows
      .map((x) => ({
        visitId: x.visitId,
        recordedAt: x.recordedAt,
        month: this.month(x.recordedAt),
        site: x.site,
        batteryVoltageV: num(x.batteryVoltageV),
        minUnitVoltageV: num(x.minUnitVoltageV),
        maxUnitVoltageV: num(x.maxUnitVoltageV),
        unitsRecorded: x.unitsRecorded,
      }))
      .filter((x) => inMonths.has(x.month));
    const generator = generatorRows
      .map((x) => ({
        visitId: x.visitId,
        recordedAt: x.recordedAt,
        month: this.month(x.recordedAt),
        site: x.site,
        runningHours: num(x.runningHours),
        fuelLevelPct: num(x.fuelLevelPct),
        generatorKva: num(x.generatorKva),
        requiresService: x.requiresService,
        oilPressure: x.oilPressure,
      }))
      .filter((x) => inMonths.has(x.month));

    return {
      range: r,
      thresholds: t,
      dc: section(dc, r.months, (x) => dcFlags(x, t), (rows) => ({
        avgDcPowerKw: mean(rows.map((x) => x.dcPowerKw)),
        maxDcPowerKw: max(rows.map((x) => x.dcPowerKw)),
        avgLoadCurrentA: mean(rows.map((x) => x.loadCurrentA)),
        avgRectifierVoltageV: mean(rows.map((x) => x.rectifierVoltageV)),
      })),
      battery: section(battery, r.months, (x) => batteryFlags(x, t), (rows) => ({
        avgBatteryVoltageV: mean(rows.map((x) => x.batteryVoltageV)),
        minBatteryVoltageV: min(rows.map((x) => x.batteryVoltageV)),
        minUnitVoltageV: min(rows.map((x) => x.minUnitVoltageV)),
      })),
      generator: section(generator, r.months, (x) => generatorFlags(x, t), (rows) => ({
        avgFuelLevelPct: mean(rows.map((x) => x.fuelLevelPct)),
        avgRunningHours: mean(rows.map((x) => x.runningHours)),
        requiresService: rows.filter((x) => x.requiresService === true).length,
      })),
    };
  }

  /**
   * Failures detected and closed per month, what was detected in the period
   * by severity and category, the sites and checklist items with the most,
   * and how long closing took (failures closed in the period).
   */
  async failures(query: unknown, caller: AuthUser) {
    const q = parseInput(FailuresQuery, query);
    const r = this.range(q);
    const inMonths = new Set(r.months);
    const span = this.instants(r);
    const site = this.siteWhere(caller, q);
    const [detected, closed, openNow] = await Promise.all([
      this.prisma.failure.findMany({
        where: { site, detectedAt: span },
        select: { detectedAt: true, severity: true, category: true, status: true, site: SITE, item: { select: { id: true, code: true, prompt: true } } },
      }),
      this.prisma.failure.findMany({ where: { site, status: 'CLOSED', closedAt: span }, select: { detectedAt: true, closedAt: true } }),
      this.prisma.failure.count({ where: { site, status: { not: 'CLOSED' } } }),
    ]);
    const found = detected.filter((f) => inMonths.has(this.month(f.detectedAt)));
    const shut = closed.filter((f) => f.closedAt && inMonths.has(this.month(f.closedAt)));

    const trend = new Map(r.months.map((m) => [m, { detected: 0, closed: 0 }]));
    for (const f of found) trend.get(this.month(f.detectedAt))!.detected++;
    for (const f of shut) trend.get(this.month(f.closedAt!))!.closed++;

    const bySite = new Map<string, { site: (typeof found)[number]['site']; count: number; open: number }>();
    const byItem = new Map<string, { id: string; code: string; prompt: string; count: number }>();
    for (const f of found) {
      const s = bySite.get(f.site.id) ?? { site: f.site, count: 0, open: 0 };
      s.count++;
      if (f.status !== 'CLOSED') s.open++;
      bySite.set(f.site.id, s);
      if (f.item) {
        const i = byItem.get(f.item.id) ?? { ...f.item, count: 0 };
        i.count++;
        byItem.set(f.item.id, i);
      }
    }
    const days = shut.map((f) => Math.round(((f.closedAt!.getTime() - f.detectedAt.getTime()) / DAY_MS) * 10) / 10);

    return {
      range: r,
      detected: found.length,
      closed: shut.length,
      openNow,
      bySeverity: Object.fromEntries(SEVERITIES.map((s) => [s, found.filter((f) => f.severity === s).length])),
      byCategory: Object.fromEntries([...CATEGORIES, null].map((c) => [c ?? 'UNSPECIFIED', found.filter((f) => f.category === c).length])),
      trend: [...trend.entries()].map(([month, c]) => ({ month, ...c })),
      topSites: [...bySite.values()].sort((a, b) => b.count - a.count || a.site.siteCode.localeCompare(b.site.siteCode)).slice(0, TOP),
      topItems: [...byItem.values()].sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)).slice(0, TOP),
      /** Days from detection to closing, for failures closed in the period. */
      timeToClose: { count: days.length, meanDays: mean(days), medianDays: median(days) },
    };
  }
}

const max = (v: (number | null)[]) => {
  const k = v.filter((x): x is number => x != null);
  return k.length ? Math.max(...k) : null;
};
const min = (v: (number | null)[]) => {
  const k = v.filter((x): x is number => x != null);
  return k.length ? Math.min(...k) : null;
};

/** Latest reading per site (newest first in `rows`) with flags, and monthly figures. */
function section<R extends { month: Month; recordedAt: Date; site: { id: string; siteCode: string } }, S>(
  rows: R[],
  months: Month[],
  flag: (r: R) => PowerFlag[],
  figures: (rows: R[]) => S,
) {
  const latest = new Map<string, R>();
  for (const x of rows) if (!latest.has(x.site.id)) latest.set(x.site.id, x);
  const sites = [...latest.values()].map((x) => {
    const { month: _month, ...rest } = x;
    return { ...rest, flags: flag(x) };
  });
  return {
    readings: rows.length,
    sitesReported: sites.length,
    sitesFlagged: sites.filter((s) => s.flags.length).length,
    overall: figures(rows),
    sites: sites.sort((a, b) => b.flags.length - a.flags.length || a.site.siteCode.localeCompare(b.site.siteCode)),
    trend: months.map((month) => {
      const inMonth = rows.filter((x) => x.month === month);
      return { month, readings: inMonth.length, ...figures(inMonth) };
    }),
  };
}
