import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth-user.js';
import { siteScope, userScope, within } from '../authz/scope.js';
import { parseInput } from '../common/validation.js';
import { AppConfig } from '../config/app-config.js';
import { failureNumber, actionNumber } from '../failures/failure-rules.js';
import type { Prisma } from '../generated/prisma/client.js';
import { OPEN_SCHEDULE } from '../organisation/site-overview.js';
import { addDays, addMonths, toDate, todayIn } from '../pm/dates.js';
import { PrismaService } from '../prisma/prisma.service.js';

const ACTIVE_ACTION = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED'] as const;
const WORKING_ACTION = ['ASSIGNED', 'IN_PROGRESS'] as const;
const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
const DAY_MS = 86_400_000;

export const PeopleQuery = z.strictObject({
  role: z.enum(['TECHNICIAN', 'REGIONAL_SUPERVISOR']),
  q: z.string().trim().max(100).optional(),
  regionId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const SearchQuery = z.strictObject({ q: z.string().trim().min(2).max(100) });

/**
 * Read-only views across modules for the web dashboard: the KPI summary,
 * technicians' and supervisors' workload, and global search. Every figure is
 * counted from the database within the caller's scope; nothing is estimated.
 */
@Injectable()
export class InsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  private today() {
    return todayIn(this.config.orgTimezone);
  }

  /** The dashboard: sites, this month's PM, reviews, failures and corrective actions. */
  async dashboard(caller: AuthUser) {
    const scope = siteScope(caller);
    const site = scope ? { site: scope } : {};
    const today = this.today();
    const monthStart = `${today.slice(0, 7)}-01`;
    const nextMonth = addMonths(monthStart, 1);
    const inMonth = { dueDate: { gte: toDate(monthStart), lt: toDate(nextMonth) } };
    const thirtyDaysAgo = new Date(Date.now() - 30 * DAY_MS);
    const db = this.prisma;

    const [sitesDemo, byCategory] = await Promise.all([
      db.site.count({ where: within(scope, { isDemo: true }) }),
      db.failure.groupBy({ by: ['category'], where: { ...site, status: { not: 'CLOSED' } }, _count: { _all: true } }),
    ]);
    const [sitesTotal, sitesActive, dueThisMonth, doneThisMonth, overdue, inProgress, awaitingReview, returned] = await Promise.all([
      db.site.count({ where: within(scope, {}) }),
      db.site.count({ where: within(scope, { status: 'ACTIVE' }) }),
      db.pmSchedule.count({ where: { ...site, ...inMonth, status: { not: 'CANCELLED' } } }),
      db.pmSchedule.count({ where: { ...site, ...inMonth, status: { in: ['COMPLETED', 'APPROVED'] } } }),
      db.pmSchedule.count({ where: { ...site, status: 'OVERDUE' } }),
      db.pmVisit.count({ where: { ...site, status: 'IN_PROGRESS' } }),
      db.pmVisit.count({ where: { ...site, status: 'COMPLETED' } }),
      db.pmVisit.count({ where: { ...site, status: 'REJECTED' } }),
    ]);
    const [failuresBySeverity, newFailures, actionsActive, actionsOverdue, actionsToVerify, recentVisits, recentFailures] = await Promise.all([
      db.failure.groupBy({ by: ['severity'], where: { ...site, status: { not: 'CLOSED' } }, _count: { _all: true } }),
      db.failure.count({ where: { ...site, detectedAt: { gte: thirtyDaysAgo } } }),
      db.correctiveAction.count({ where: { ...site, status: { in: [...ACTIVE_ACTION] } } }),
      db.correctiveAction.count({ where: { ...site, status: { in: [...WORKING_ACTION] }, dueDate: { lt: toDate(today) } } }),
      db.correctiveAction.count({ where: { ...site, status: 'COMPLETED' } }),
      db.pmVisit.findMany({
        where: { ...site, status: { in: ['COMPLETED', 'APPROVED', 'REJECTED'] } },
        orderBy: { completedAt: 'desc' },
        take: 5,
        select: { id: true, status: true, completedAt: true, completionPct: true, failureCount: true, site: { select: { id: true, siteCode: true, siteName: true } }, technician: { select: { id: true, fullName: true } } },
      }),
      db.failure.findMany({
        where: { ...site, status: { not: 'CLOSED' } },
        orderBy: [{ detectedAt: 'desc' }, { number: 'desc' }],
        take: 5,
        select: { id: true, number: true, title: true, severity: true, status: true, detectedAt: true, site: { select: { id: true, siteCode: true, siteName: true } } },
      }),
    ]);
    const bySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, failuresBySeverity.find((f) => f.severity === s)?._count._all ?? 0])) as Record<(typeof SEVERITIES)[number], number>;
    return {
      asOf: today,
      month: { from: monthStart, to: addDays(nextMonth, -1) },
      /** Demo sites (seeded reference data, not live operations) are counted in the totals and flagged here. */
      sites: { total: sitesTotal, active: sitesActive, demo: sitesDemo },
      pm: {
        dueThisMonth,
        completedThisMonth: doneThisMonth,
        /** Completed or approved ÷ due this month (not cancelled); null when nothing is due. */
        completionRatePct: dueThisMonth ? Math.round((1000 * doneThisMonth) / dueThisMonth) / 10 : null,
        overdue,
        inProgress,
        awaitingReview,
        returnedForCorrection: returned,
      },
      failures: {
        open: Object.values(bySeverity).reduce((a, b) => a + b, 0),
        bySeverity,
        /** Open failures by PM section category (null: reported by hand without one). */
        byCategory: Object.fromEntries(byCategory.map((c) => [c.category ?? 'UNSPECIFIED', c._count._all])),
        newLast30Days: newFailures,
      },
      correctiveActions: { active: actionsActive, overdue: actionsOverdue, awaitingVerification: actionsToVerify },
      recentVisits: recentVisits.map((v) => ({ ...v, completionPct: Number(v.completionPct) })),
      recentFailures: recentFailures.map((f) => ({ ...f, number: failureNumber(f.number) })),
    };
  }

  /** Technicians or supervisors in the caller's scope, with their current workload. */
  async people(query: unknown, caller: AuthUser) {
    const q = parseInput(PeopleQuery, query);
    const where = within<Prisma.UserWhereInput>(userScope(caller), {
      AND: [
        { roles: { some: { role: { code: q.role } } } },
        q.regionId
          ? { OR: [{ homeRegionId: q.regionId }, { regionScopes: { some: { regionId: q.regionId } } }, { siteAssignments: { some: { active: true, site: { regionId: q.regionId } } } }] }
          : {},
        q.q ? { OR: [{ fullName: { contains: q.q } }, { email: { contains: q.q } }, { employeeCode: { contains: q.q } }] } : {},
      ],
    });
    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
          employeeCode: true,
          isActive: true,
          lastLoginAt: true,
          homeRegion: { select: { id: true, name: true } },
          regionScopes: { select: { region: { select: { id: true, name: true } } } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);
    const ids = users.map((u) => u.id);
    const items = q.role === 'TECHNICIAN' ? await this.technicianLoad(ids) : await this.supervisorLoad(users.map((u) => ({ id: u.id, regionIds: u.regionScopes.map((r) => r.region.id) })));
    return {
      items: users.map(({ regionScopes, ...u }) => ({ ...u, regions: regionScopes.map((r) => r.region), workload: items.get(u.id)! })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  private async technicianLoad(ids: string[]) {
    const today = toDate(this.today());
    const since = new Date(Date.now() - 30 * DAY_MS);
    const db = this.prisma;
    const [sites, openPms, overduePms, completed, lastVisit, actions, overdueActions] = await Promise.all([
      db.siteAssignment.groupBy({ by: ['userId'], where: { userId: { in: ids }, role: 'TECHNICIAN', active: true }, _count: { _all: true } }),
      db.pmSchedule.groupBy({ by: ['technicianId'], where: { technicianId: { in: ids }, status: { in: [...OPEN_SCHEDULE] } }, _count: { _all: true } }),
      db.pmSchedule.groupBy({ by: ['technicianId'], where: { technicianId: { in: ids }, status: 'OVERDUE' }, _count: { _all: true } }),
      db.pmVisit.groupBy({ by: ['technicianId'], where: { technicianId: { in: ids }, status: { in: ['COMPLETED', 'APPROVED'] }, completedAt: { gte: since } }, _count: { _all: true } }),
      db.pmVisit.groupBy({ by: ['technicianId'], where: { technicianId: { in: ids } }, _max: { startedAt: true } }),
      db.correctiveAction.groupBy({ by: ['assignedToId'], where: { assignedToId: { in: ids }, status: { in: [...WORKING_ACTION] } }, _count: { _all: true } }),
      db.correctiveAction.groupBy({ by: ['assignedToId'], where: { assignedToId: { in: ids }, status: { in: [...WORKING_ACTION] }, dueDate: { lt: today } }, _count: { _all: true } }),
    ]);
    const n = <K extends string>(rows: ({ _count: { _all: number } } & Record<K, string | null>)[], key: K, id: string) => rows.find((r) => r[key] === id)?._count._all ?? 0;
    return new Map(
      ids.map((id) => [
        id,
        {
          assignedSites: n(sites, 'userId', id),
          openPms: n(openPms, 'technicianId', id),
          overduePms: n(overduePms, 'technicianId', id),
          completedLast30Days: n(completed, 'technicianId', id),
          lastVisitAt: lastVisit.find((v) => v.technicianId === id)?._max.startedAt ?? null,
          openActions: n(actions, 'assignedToId', id),
          overdueActions: n(overdueActions, 'assignedToId', id),
        },
      ]),
    );
  }

  private async supervisorLoad(people: { id: string; regionIds: string[] }[]) {
    const db = this.prisma;
    const out = new Map<string, { supervisedSites: number; sitesInRegions: number; awaitingReview: number; openFailures: number; actionsToVerify: number }>();
    for (const p of people) {
      // Their sites: the regions of their scope plus sites they supervise.
      const site: Prisma.SiteWhereInput = { OR: [{ regionId: { in: p.regionIds } }, { assignments: { some: { userId: p.id, role: 'SUPERVISOR', active: true } } }] };
      const [supervisedSites, sitesInRegions, awaitingReview, openFailures, actionsToVerify] = await Promise.all([
        db.siteAssignment.count({ where: { userId: p.id, role: 'SUPERVISOR', active: true } }),
        db.site.count({ where: { regionId: { in: p.regionIds } } }),
        db.pmVisit.count({ where: { status: 'COMPLETED', site } }),
        db.failure.count({ where: { status: { not: 'CLOSED' }, site } }),
        db.correctiveAction.count({ where: { status: 'COMPLETED', site } }),
      ]);
      out.set(p.id, { supervisedSites, sitesInRegions, awaitingReview, openFailures, actionsToVerify });
    }
    return out;
  }

  /** Sites, failures, corrective actions and people matching the text, within the caller's scope and permissions (up to 5 each). */
  async search(query: unknown, caller: AuthUser) {
    const { q } = parseInput(SearchQuery, query);
    const can = (p: string) => caller.permissions.includes(p);
    const scope = siteScope(caller);
    const onSite = scope ? { site: scope } : {};
    const failureNo = q.match(/^(?:FL-)?0*(\d{1,9})$/i);
    const actionNo = q.match(/^(?:CA-)?0*(\d{1,9})$/i);
    const take = 5;
    const [sites, failures, actions, people] = await Promise.all([
      can('sites.read')
        ? this.prisma.site.findMany({
            where: within(scope, { OR: [{ siteCode: { contains: q } }, { siteName: { contains: q } }] }),
            orderBy: { siteCode: 'asc' },
            take,
            select: { id: true, siteCode: true, siteName: true, status: true, region: { select: { name: true } } },
          })
        : [],
      can('failures.read')
        ? this.prisma.failure.findMany({
            where: { ...onSite, OR: [{ title: { contains: q } }, ...(failureNo ? [{ number: Number(failureNo[1]) }] : [])] },
            orderBy: { detectedAt: 'desc' },
            take,
            select: { id: true, number: true, title: true, status: true, severity: true, site: { select: { siteCode: true } } },
          })
        : [],
      can('corrective_actions.read')
        ? this.prisma.correctiveAction.findMany({
            where: { ...onSite, OR: [{ title: { contains: q } }, ...(actionNo ? [{ number: Number(actionNo[1]) }] : [])] },
            orderBy: { createdAt: 'desc' },
            take,
            select: { id: true, number: true, title: true, status: true, site: { select: { siteCode: true } } },
          })
        : [],
      can('users.read')
        ? this.prisma.user.findMany({
            where: within<Prisma.UserWhereInput>(userScope(caller), { OR: [{ fullName: { contains: q } }, { email: { contains: q } }, { employeeCode: { contains: q } }] }),
            orderBy: { fullName: 'asc' },
            take,
            select: { id: true, fullName: true, email: true, isActive: true, roles: { select: { role: { select: { code: true } } } } },
          })
        : [],
    ]);
    return {
      q,
      sites,
      failures: failures.map((f) => ({ ...f, number: failureNumber(f.number) })),
      correctiveActions: actions.map((a) => ({ ...a, number: actionNumber(a.number) })),
      people: people.map(({ roles, ...u }) => ({ ...u, roles: roles.map((r) => r.role.code).sort() })),
    };
  }
}

