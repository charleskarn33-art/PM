import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { AppConfig } from '../config/app-config.js';
import { actionNumber } from '../failures/failure-rules.js';
import { addDays, toDate, toIso, todayIn } from '../pm/dates.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { NotificationsService } from './notifications.service.js';
import { PushSender } from './push.sender.js';

const HOURLY = 60 * 60 * 1000;
const PUSH_EVERY = 15 * 1000;

/**
 * Scheduled notifications, run hourly (each event notifies once, so running
 * more often, or on several instances, never repeats one), and the push
 * sender's loop when push is enabled. Reminders are sent only when an
 * administrator has configured them.
 */
@Injectable()
export class NotificationJobs implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger(NotificationJobs.name);
  private timers: NodeJS.Timeout[] = [];
  private pushing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly push: PushSender,
  ) {}

  onApplicationBootstrap() {
    if (this.config.env === 'test') return; // tests call the jobs directly
    void this.safe('reminders', () => this.reminders());
    this.timers.push(setInterval(() => void this.safe('reminders', () => this.reminders()), HOURLY));
    if (this.config.push.enabled) this.timers.push(setInterval(() => void this.pushRound(), PUSH_EVERY));
    this.timers.forEach((t) => t.unref());
  }

  onApplicationShutdown() {
    this.timers.forEach(clearInterval);
  }

  private async pushRound() {
    if (this.pushing) return;
    this.pushing = true;
    try {
      // Keep going while full batches come back.
      while ((await this.push.runOnce()) >= 100);
    } catch (err) {
      this.log.error({ err }, 'push round failed');
    } finally {
      this.pushing = false;
    }
  }

  private async safe(name: string, job: () => Promise<unknown>) {
    try {
      await job();
    } catch (err) {
      this.log.error({ err }, `${name} failed`);
    }
  }

  /** PM-due reminders and overdue corrective-action alerts, as configured. Returns how many notifications were created. */
  async reminders(today = todayIn(this.config.orgTimezone)): Promise<number> {
    const cfg = await this.settings.get('notifications');
    let created = 0;
    if (cfg.pmDueReminderDays) {
      // Due within the reminder window and not started: one reminder per PM.
      const due = await this.prisma.pmSchedule.findMany({
        where: { status: 'SCHEDULED', technicianId: { not: null }, dueDate: { gte: toDate(today), lte: toDate(addDays(today, cfg.pmDueReminderDays)) } },
        select: { id: true, dueDate: true, technicianId: true, site: { select: { siteCode: true, siteName: true } } },
      });
      for (const s of due) {
        const dueIso = toIso(s.dueDate);
        created += await this.notifications.notify(this.prisma, {
          userIds: [s.technicianId],
          actorId: null,
          type: 'PM_DUE_SOON',
          title: `PM due ${dueIso === today ? 'today' : `on ${dueIso}`}`,
          body: `${s.site.siteCode} · ${s.site.siteName}`,
          entity: { type: 'schedule', id: s.id },
          key: `pm-due:${s.id}:${dueIso}`,
        });
      }
    }
    if (cfg.actionOverdueAlerts) {
      const overdue = await this.prisma.correctiveAction.findMany({
        where: { status: { in: ['ASSIGNED', 'IN_PROGRESS'] }, dueDate: { lt: toDate(today) } },
        select: { id: true, number: true, title: true, dueDate: true, siteId: true, assignedToId: true, site: { select: { siteCode: true } } },
      });
      for (const a of overdue) {
        const dueIso = toIso(a.dueDate!);
        created += await this.notifications.notify(this.prisma, {
          userIds: [a.assignedToId, ...(await this.notifications.siteSupervisors(this.prisma, a.siteId))],
          actorId: null,
          type: 'ACTION_OVERDUE',
          title: `${actionNumber(a.number)} is overdue`,
          body: `${a.title} — ${a.site.siteCode}, due ${dueIso}`,
          entity: { type: 'action', id: a.id },
          key: `action-overdue:${a.id}:${dueIso}`,
        });
      }
    }
    if (created) this.log.log({ count: created }, 'reminders sent');
    return created;
  }
}
