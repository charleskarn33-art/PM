import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { AppConfig } from '../config/app-config.js';
import { SchedulesService } from './schedules.service.js';

const HOURLY = 60 * 60 * 1000;

/**
 * Marks PMs overdue (scheduled, due date passed in the organisation's time
 * zone) at start-up and every hour. The update is idempotent, so running it
 * on several API instances is harmless. Moves to the worker in Phase 12.
 */
@Injectable()
export class OverdueJob implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OverdueJob.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly schedules: SchedulesService,
    private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap() {
    if (this.config.env === 'test') return; // tests call markOverdue() directly
    void this.run();
    this.timer = setInterval(() => void this.run(), HOURLY);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  private async run() {
    try {
      const n = await this.schedules.markOverdue();
      if (n) this.logger.log({ count: n }, 'PM schedules marked overdue');
    } catch (err) {
      this.logger.error({ err }, 'Marking overdue PM schedules failed');
    }
  }
}
