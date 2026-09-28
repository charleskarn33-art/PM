import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth-user.js';
import { notFound } from '../common/prisma-errors.js';
import { parseInput } from '../common/validation.js';
import { AppConfig } from '../config/app-config.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

type Db = Prisma.TransactionClient | PrismaService;

export const NOTIFICATION_TYPES = [
  'PM_SUBMITTED',
  'PM_APPROVED',
  'PM_RETURNED',
  'PM_SCHEDULED',
  'PM_DUE_SOON',
  'PM_OVERDUE',
  'SITE_ASSIGNED',
  'FAILURE_CRITICAL',
  'ACTION_ASSIGNED',
  'ACTION_RETURNED',
  'ACTION_COMPLETED',
  'ACTION_OVERDUE',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export type EntityType = 'visit' | 'schedule' | 'site' | 'failure' | 'action';

export interface NotifyInput {
  /** Candidate recipients; the actor, inactive users and repeats are dropped. */
  userIds: (string | null | undefined)[];
  /** Who caused it (never notified about their own action); null for the system. */
  actorId: string | null;
  type: NotificationType;
  title: string;
  body: string;
  entity: { type: EntityType; id: string } | null;
  /** The event's identity: a user is notified at most once per key. */
  key: string;
}

export const ListQuery = z.strictObject({
  unread: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export const PushTokenInput = z.strictObject({
  token: z.string().trim().regex(/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,200}\]$/, 'not an Expo push token'),
  platform: z.enum(['android', 'ios']),
  deviceName: z.string().trim().max(120).optional(),
});

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * In-app notifications (and the queue for push). Written in the same
 * transaction as the change that causes them, so a notification exists only
 * if the change happened.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  /** Creates the notifications; returns how many were new. */
  async notify(db: Db, n: NotifyInput): Promise<number> {
    const ids = [...new Set(n.userIds.filter((id): id is string => !!id && id !== n.actorId))];
    if (!ids.length) return 0;
    const active = await db.user.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true } });
    if (!active.length) return 0;
    const { count } = await db.notification.createMany({
      data: active.map((u) => ({
        userId: u.id,
        type: n.type,
        title: clip(n.title, 200),
        body: clip(n.body, 1000),
        entityType: n.entity?.type ?? null,
        entityId: n.entity?.id ?? null,
        dedupKey: clip(n.key, 120),
        pushStatus: this.config.push.enabled ? 'PENDING' : null,
      })),
      skipDuplicates: true,
    });
    return count;
  }

  // --- Recipients ----------------------------------------------------------------------------

  /** The site's supervisors: supervisors assigned to it, and regional supervisors of its region. */
  async siteSupervisors(db: Db, siteId: string): Promise<string[]> {
    const site = await db.site.findUnique({ where: { id: siteId }, select: { regionId: true } });
    if (!site) return [];
    const users = await db.user.findMany({
      where: {
        isActive: true,
        OR: [
          { siteAssignments: { some: { siteId, role: 'SUPERVISOR', active: true } } },
          { roles: { some: { role: { code: 'REGIONAL_SUPERVISOR' } } }, regionScopes: { some: { regionId: site.regionId } } },
        ],
      },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }

  /** Regional managers of the site's region. */
  async regionManagers(db: Db, siteId: string): Promise<string[]> {
    const site = await db.site.findUnique({ where: { id: siteId }, select: { regionId: true } });
    if (!site) return [];
    const users = await db.user.findMany({
      where: { isActive: true, roles: { some: { role: { code: 'REGIONAL_MANAGER' } } }, regionScopes: { some: { regionId: site.regionId } } },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }

  /** Critical failures just recorded: the site's supervisors and regional managers are told once. */
  async criticalFailures(db: Db, failureIds: string[], actorId: string | null) {
    if (!failureIds.length) return;
    const failures = await db.failure.findMany({
      where: { id: { in: failureIds }, severity: 'CRITICAL', status: { not: 'CLOSED' } },
      select: { id: true, number: true, title: true, siteId: true, site: { select: { siteCode: true, siteName: true } } },
    });
    for (const f of failures) {
      const to = [...(await this.siteSupervisors(db, f.siteId)), ...(await this.regionManagers(db, f.siteId))];
      await this.notify(db, {
        userIds: to,
        actorId,
        type: 'FAILURE_CRITICAL',
        title: `Critical failure at ${f.site.siteCode}`,
        body: `${f.title} — ${f.site.siteName}`,
        entity: { type: 'failure', id: f.id },
        key: `failure-critical:${f.id}`,
      });
    }
  }

  // --- The user's own notifications ----------------------------------------------------------

  async list(query: unknown, caller: AuthUser) {
    const q = parseInput(ListQuery, query);
    const where: Prisma.NotificationWhereInput = { userId: caller.id, ...(q.unread === 'true' ? { readAt: null } : {}) };
    const [items, total, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: { id: true, type: true, title: true, body: true, entityType: true, entityId: true, readAt: true, createdAt: true },
      }),
      this.prisma.notification.count({ where }),
      this.unreadCount(caller),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize, unread };
  }

  unreadCount(caller: AuthUser) {
    return this.prisma.notification.count({ where: { userId: caller.id, readAt: null } });
  }

  async markRead(id: string, caller: AuthUser) {
    const n = await this.prisma.notification.findFirst({ where: { id, userId: caller.id }, select: { id: true, readAt: true } });
    if (!n) throw notFound('Notification');
    if (!n.readAt) await this.prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
    return { unread: await this.unreadCount(caller) };
  }

  async markAllRead(caller: AuthUser) {
    const { count } = await this.prisma.notification.updateMany({ where: { userId: caller.id, readAt: null }, data: { readAt: new Date() } });
    return { marked: count, unread: 0 };
  }

  // --- Push tokens ---------------------------------------------------------------------------

  /** Registers this phone for the signed-in user (a phone that changed hands moves to its new user). */
  async registerToken(input: unknown, caller: AuthUser) {
    const t = parseInput(PushTokenInput, input);
    await this.prisma.pushToken.upsert({
      where: { token: t.token },
      create: { userId: caller.id, token: t.token, platform: t.platform, deviceName: t.deviceName ?? null },
      update: { userId: caller.id, platform: t.platform, deviceName: t.deviceName ?? null, lastSeenAt: new Date() },
    });
    return { registered: true, pushEnabled: this.config.push.enabled };
  }

  /** Removes a token (sign-out); only the caller's own. */
  async unregisterToken(input: unknown, caller: AuthUser) {
    const { token } = parseInput(z.strictObject({ token: z.string().trim().min(1).max(255) }), input);
    const { count } = await this.prisma.pushToken.deleteMany({ where: { token, userId: caller.id } });
    return { removed: count };
  }
}
