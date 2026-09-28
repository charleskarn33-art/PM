import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../config/app-config.js';
import { PrismaService } from '../prisma/prisma.service.js';

const BATCH = 100; // Expo accepts up to 100 messages per request
const MAX_ATTEMPTS = 3;
const STALE_MS = 24 * 60 * 60 * 1000; // older notifications are not pushed any more
const STUCK_MS = 10 * 60 * 1000; // a claim older than this was lost (the process stopped)

interface Ticket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

/**
 * Sends pending notifications to the phones through Expo's push service.
 * Runs only when PUSH_ENABLED=true. Rows are claimed with one UPDATE before
 * sending, so several API instances never send the same notification twice.
 * Tokens Expo reports as no longer registered are removed.
 */
@Injectable()
export class PushSender {
  private readonly log = new Logger(PushSender.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  /** One round: returns how many notifications were handled. */
  async runOnce(now = new Date()): Promise<number> {
    if (!this.config.push.enabled) return 0;
    await this.prisma.notification.updateMany({ where: { pushStatus: 'PENDING', createdAt: { lt: new Date(now.getTime() - STALE_MS) } }, data: { pushStatus: 'SKIPPED', pushError: 'Too old to push' } });
    await this.prisma.notification.updateMany({ where: { pushStatus: 'SENDING', pushClaimedAt: { lt: new Date(now.getTime() - STUCK_MS) } }, data: { pushStatus: 'PENDING', pushClaim: null, pushClaimedAt: null } });
    const claim = randomUUID();
    const claimed = await this.prisma.$executeRaw`UPDATE notifications SET push_status = 'SENDING', push_claim = ${claim}, push_claimed_at = ${now} WHERE push_status = 'PENDING' ORDER BY created_at LIMIT ${BATCH}`;
    if (!claimed) return 0;

    const rows = await this.prisma.notification.findMany({
      where: { pushClaim: claim, pushStatus: 'SENDING' },
      select: { id: true, title: true, body: true, entityType: true, entityId: true, pushAttempts: true, user: { select: { pushTokens: { select: { token: true } } } } },
    });
    const messages: { notificationId: string; token: string; payload: Record<string, unknown> }[] = [];
    const noDevice: string[] = [];
    for (const n of rows) {
      if (!n.user.pushTokens.length) noDevice.push(n.id);
      for (const { token } of n.user.pushTokens)
        messages.push({
          notificationId: n.id,
          token,
          payload: { to: token, title: n.title, body: n.body, sound: 'default', data: { notificationId: n.id, entityType: n.entityType, entityId: n.entityId } },
        });
    }
    if (noDevice.length) await this.prisma.notification.updateMany({ where: { id: { in: noDevice } }, data: { pushStatus: 'NO_DEVICE', pushClaim: null } });

    const ok = new Set<string>();
    const errors = new Map<string, string>();
    const unregistered = new Set<string>();
    const unsent = new Set<string>();
    for (let i = 0; i < messages.length; i += BATCH) {
      const chunk = messages.slice(i, i + BATCH);
      let tickets: Ticket[];
      try {
        tickets = await this.post(chunk.map((m) => m.payload));
      } catch (e) {
        this.log.warn({ err: e instanceof Error ? e.message : String(e), count: chunk.length }, 'push request failed');
        chunk.forEach((m) => unsent.add(m.notificationId));
        continue;
      }
      chunk.forEach((m, j) => {
        const t = tickets[j];
        if (t?.status === 'ok') ok.add(m.notificationId);
        else if (t?.details?.error === 'DeviceNotRegistered') unregistered.add(m.token);
        else errors.set(m.notificationId, (t?.details?.error ?? t?.message ?? 'No ticket').slice(0, 255));
      });
    }

    if (unregistered.size) await this.prisma.pushToken.deleteMany({ where: { token: { in: [...unregistered] } } });
    const sentAt = new Date();
    for (const n of rows) {
      if (noDevice.includes(n.id)) continue;
      if (ok.has(n.id)) {
        await this.prisma.notification.update({ where: { id: n.id }, data: { pushStatus: 'SENT', pushedAt: sentAt, pushClaim: null, pushError: null, pushAttempts: { increment: 1 } } });
      } else if (unsent.has(n.id) && n.pushAttempts + 1 < MAX_ATTEMPTS) {
        await this.prisma.notification.update({ where: { id: n.id }, data: { pushStatus: 'PENDING', pushClaim: null, pushAttempts: { increment: 1 } } });
      } else if (!errors.has(n.id) && !unsent.has(n.id)) {
        // Every device of this user is gone.
        await this.prisma.notification.update({ where: { id: n.id }, data: { pushStatus: 'NO_DEVICE', pushClaim: null, pushAttempts: { increment: 1 } } });
      } else {
        await this.prisma.notification.update({
          where: { id: n.id },
          data: { pushStatus: 'FAILED', pushClaim: null, pushError: errors.get(n.id) ?? 'Push service unreachable', pushAttempts: { increment: 1 } },
        });
      }
    }
    return rows.length;
  }

  private async post(messages: Record<string, unknown>[]): Promise<Ticket[]> {
    const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json' };
    if (this.config.push.accessToken) headers.Authorization = `Bearer ${this.config.push.accessToken}`;
    const res = await fetch(this.config.push.url, { method: 'POST', headers, body: JSON.stringify(messages), signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`push service answered ${res.status}`);
    const body = (await res.json()) as { data?: Ticket[] };
    if (!Array.isArray(body.data)) throw new Error('push service answered without tickets');
    return body.data;
  }
}
