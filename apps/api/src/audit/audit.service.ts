import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { notFound } from '../common/prisma-errors.js';
import { parseInput } from '../common/validation.js';
import { AppConfig } from '../config/app-config.js';
import type { Prisma } from '../generated/prisma/client.js';
import { toDate, todayIn } from '../pm/dates.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { batched } from '../reports/exports.service.js';
import { BOM, csvRow } from '../reports/csv.js';
import type { Snapshot } from './audit-actions.js';

export interface AuditEntry {
  actor: { id: string; fullName?: string | null; email?: string | null } | null;
  action: string;
  outcome?: 'SUCCESS' | 'DENIED' | 'FAILED';
  entityType: string | null;
  entityId: string | null;
  summary: string;
  method: string;
  path: string;
  changes?: Prisma.InputJsonValue | null;
  request?: Prisma.InputJsonValue | null;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

const ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');
export const AuditQuery = z.strictObject({
  q: z.string().trim().max(100).optional(),
  action: z.string().trim().max(60).optional(),
  entityType: z.string().trim().max(40).optional(),
  entityId: z.string().trim().max(64).optional(),
  actorId: z.uuid().optional(),
  outcome: z.enum(['SUCCESS', 'DENIED', 'FAILED']).optional(),
  from: ISO_DATE.optional(),
  to: ISO_DATE.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

const clip = (s: string | null | undefined, n: number) => (s == null ? null : s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * The audit log: written for every change made through the API (by the
 * audit interceptor), refused attempts and sign-in failures, and for reports
 * and exports handed out. Append-only in the database. Read by Super Admins.
 */
@Injectable()
export class AuditService {
  private readonly log = new Logger(AuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  /** Writes an entry. Never throws: a failed write is logged as an error (the change itself already happened). */
  async record(e: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: e.actor?.id ?? null,
          actorName: clip(e.actor?.fullName, 120),
          actorEmail: clip(e.actor?.email, 255),
          action: clip(e.action, 60)!,
          outcome: e.outcome ?? 'SUCCESS',
          entityType: e.entityType,
          entityId: clip(e.entityId, 64),
          summary: clip(e.summary, 500)!,
          method: e.method,
          path: clip(e.path, 255)!,
          changes: e.changes ?? undefined,
          request: e.request ?? undefined,
          ip: clip(e.ip, 64),
          userAgent: clip(e.userAgent, 255),
          requestId: clip(e.requestId, 64),
        },
      });
    } catch (err) {
      this.log.error({ err, action: e.action, entityId: e.entityId }, 'audit entry could not be written');
    }
  }

  /** The record as it is now, for before/after comparison (null: not found). */
  async snapshot(model: Snapshot, id: string): Promise<Record<string, unknown> | null> {
    const db = this.prisma;
    switch (model) {
      case 'user': {
        const u = await db.user.findUnique({
          where: { id },
          include: { roles: { select: { role: { select: { code: true } } } }, regionScopes: { select: { region: { select: { name: true } } } } },
        });
        if (!u) return null;
        const { roles, regionScopes, ...rest } = u;
        return { ...rest, roles: roles.map((r) => r.role.code).sort(), regions: regionScopes.map((r) => r.region.name).sort() };
      }
      case 'systemSetting':
        return db.systemSetting.findUnique({ where: { key: id } });
      default: {
        const delegate = (db as unknown as Record<Snapshot, { findUnique: (a: { where: { id: string } }) => Promise<Record<string, unknown> | null> }>)[model];
        return delegate.findUnique({ where: { id } });
      }
    }
  }

  private where(q: z.infer<typeof AuditQuery>): Prisma.AuditLogWhereInput {
    return {
      AND: [
        q.action ? { action: q.action } : {},
        q.entityType ? { entityType: q.entityType } : {},
        q.entityId ? { entityId: q.entityId } : {},
        q.actorId ? { actorId: q.actorId } : {},
        q.outcome ? { outcome: q.outcome } : {},
        q.from ? { occurredAt: { gte: toDate(q.from) } } : {},
        q.to ? { occurredAt: { lt: new Date(toDate(q.to).getTime() + 86_400_000) } } : {},
        q.q
          ? { OR: [{ summary: { contains: q.q } }, { actorName: { contains: q.q } }, { actorEmail: { contains: q.q } }, { entityId: q.q }, { requestId: q.q }, { path: { contains: q.q } }] }
          : {},
      ],
    };
  }

  async list(query: unknown) {
    const q = parseInput(AuditQuery, query);
    const where = this.where(q);
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        omit: { request: true, changes: true, userAgent: true },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  async get(id: string) {
    const e = await this.prisma.auditLog.findUnique({ where: { id } });
    if (!e) throw notFound('Audit entry');
    return e;
  }

  /** CSV of the entries matching the filters, oldest first, every row. */
  exportCsv(query: unknown): { fileName: string; body: AsyncGenerator<string> } {
    const q = parseInput(AuditQuery, query);
    const where = this.where(q);
    const prisma = this.prisma;
    const tz = this.config.orgTimezone;
    async function* body() {
      yield BOM + csvRow(['When (UTC)', 'Who', 'Email', 'Action', 'Outcome', 'Record type', 'Record', 'Summary', 'Changes', 'Method', 'Path', 'IP', 'Request ID']);
      for await (const e of batched((p) => prisma.auditLog.findMany({ ...p, where }))) {
        yield csvRow([
          e.occurredAt.toISOString().replace('T', ' ').slice(0, 19),
          e.actorName,
          e.actorEmail,
          e.action,
          e.outcome,
          e.entityType,
          e.entityId,
          e.summary,
          e.changes ? JSON.stringify(e.changes) : null,
          e.method,
          e.path,
          e.ip,
          e.requestId,
        ]);
      }
    }
    return { fileName: `audit-log-${todayIn(tz)}.csv`, body: body() };
  }
}
