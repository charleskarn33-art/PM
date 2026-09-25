import { Controller, Get, HttpStatus, Logger } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator.js';
import { AppError } from '../common/http-exception.filter.js';
import { AppConfig } from '../config/app-config.js';
import { PrismaService } from '../prisma/prisma.service.js';

const DB_TIMEOUT_MS = 3000;

@Controller('health')
@Public()
@SkipThrottle()
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  /** Liveness: the process is up (no dependencies checked). */
  @Get()
  live() {
    return { status: 'ok', version: this.config.version };
  }

  /** Readiness: the API can reach MySQL. 503 when it cannot. */
  @Get('ready')
  async ready() {
    const started = Date.now();
    try {
      const version = await Promise.race([
        this.prisma.ping(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), DB_TIMEOUT_MS)),
      ]);
      return { status: 'ok', version: this.config.version, checks: { database: { status: 'up', server: version, latencyMs: Date.now() - started } } };
    } catch (err) {
      // The cause is for operators (logs); callers get a generic answer.
      this.logger.warn({ err }, 'Readiness check: database unreachable');
      throw new AppError(HttpStatus.SERVICE_UNAVAILABLE, 'SERVICE_UNAVAILABLE', 'The database is not reachable.', {
        checks: { database: { status: 'down' } },
      });
    }
  }
}
