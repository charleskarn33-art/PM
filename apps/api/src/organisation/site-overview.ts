import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { toIso } from '../pm/dates.js';

type Db = Prisma.TransactionClient | PrismaClient;

export const OPEN_SCHEDULE = ['SCHEDULED', 'OVERDUE', 'IN_PROGRESS', 'REJECTED'] as const;
const OPEN_ACTION = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED'] as const;

export interface SiteOverview {
  technicians: { id: string; fullName: string }[];
  supervisor: { id: string; fullName: string } | null;
  lastPmAt: Date | null;
  nextPm: { scheduleId: string; dueDate: string; status: string } | null;
  openFailures: number;
  openActions: number;
}

/**
 * Who works at each site and where its PM stands: active technicians and
 * supervisor, the last completed PM, the next open PM, open failures and open
 * corrective actions. For a page of sites (a handful of grouped queries).
 */
export async function siteOverview(db: Db, siteIds: readonly string[]): Promise<Map<string, SiteOverview>> {
  const ids = [...siteIds];
  const [assignments, lastPm, open, failures, actions] = await Promise.all([
    db.siteAssignment.findMany({ where: { siteId: { in: ids }, active: true }, select: { siteId: true, role: true, user: { select: { id: true, fullName: true } } }, orderBy: { startDate: 'asc' } }),
    db.pmVisit.groupBy({ by: ['siteId'], where: { siteId: { in: ids }, status: { in: ['COMPLETED', 'APPROVED'] } }, _max: { completedAt: true } }),
    db.pmSchedule.findMany({ where: { siteId: { in: ids }, status: { in: [...OPEN_SCHEDULE] } }, select: { id: true, siteId: true, dueDate: true, status: true }, orderBy: [{ dueDate: 'asc' }, { id: 'asc' }] }),
    db.failure.groupBy({ by: ['siteId'], where: { siteId: { in: ids }, status: { not: 'CLOSED' } }, _count: { _all: true } }),
    db.correctiveAction.groupBy({ by: ['siteId'], where: { siteId: { in: ids }, status: { in: [...OPEN_ACTION] } }, _count: { _all: true } }),
  ]);
  const out = new Map<string, SiteOverview>();
  for (const id of ids) {
    const next = open.find((s) => s.siteId === id);
    out.set(id, {
      technicians: assignments.filter((a) => a.siteId === id && a.role === 'TECHNICIAN').map((a) => a.user),
      supervisor: assignments.find((a) => a.siteId === id && a.role === 'SUPERVISOR')?.user ?? null,
      lastPmAt: lastPm.find((v) => v.siteId === id)?._max.completedAt ?? null,
      nextPm: next ? { scheduleId: next.id, dueDate: toIso(next.dueDate), status: next.status } : null,
      openFailures: failures.find((f) => f.siteId === id)?._count._all ?? 0,
      openActions: actions.find((a) => a.siteId === id)?._count._all ?? 0,
    });
  }
  return out;
}
