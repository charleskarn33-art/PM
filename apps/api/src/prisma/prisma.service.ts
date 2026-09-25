import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { AppConfig } from '../config/app-config.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { poolConfigFromUrl } from './database-url.js';

/** The only database client in the system (web and mobile go through the API). */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: AppConfig) {
    super({ adapter: new PrismaMariaDb(poolConfigFromUrl(config.databaseUrl)) });
  }

  /** Round trip to MySQL; returns the server version. Throws when unreachable. */
  async ping(): Promise<string> {
    const rows = await this.$queryRaw<{ version: string }[]>`SELECT VERSION() AS version`;
    return rows[0]?.version ?? 'unknown';
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
