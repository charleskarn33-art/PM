import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../generated/prisma/client.js';
import { poolConfigFromUrl } from './database-url.js';

/** A Prisma client for DATABASE_URL (scripts and tests; the API uses PrismaService). */
export function createPrismaClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaMariaDb(poolConfigFromUrl(databaseUrl)) });
}
