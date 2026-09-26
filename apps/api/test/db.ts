import { AppConfig } from '../src/config/app-config.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { seedReferenceData } from '../src/seed/reference.js';
import { assertTestDatabase } from './global-setup.js';
import { testConfig } from './support.js';

/** Tables holding data (reference tables are re-seeded, not cleared by order). */
const DATA_TABLES = ['refresh_tokens', 'site_assignments', 'user_region_scopes', 'user_roles', 'sites', 'counties', 'clusters', 'regions', 'users'];

export function testPrisma(): PrismaService {
  return new PrismaService(testConfig() as AppConfig);
}

/** Empties the data tables (one connection, FK checks off) and re-seeds roles and permissions. */
export async function resetData(prisma: PrismaService): Promise<void> {
  assertTestDatabase(process.env.TEST_DATABASE_URL);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of DATA_TABLES) await tx.$executeRawUnsafe(`DELETE FROM \`${t}\``);
    await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');
  });
  await seedReferenceData(prisma);
}
