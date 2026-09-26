import { AppConfig } from '../src/config/app-config.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { seedReferenceData } from '../src/seed/reference.js';
import { seedReferenceTemplate } from '../src/seed/reference-template.js';
import { assertTestDatabase } from './global-setup.js';
import { testConfig } from './support.js';

/** Tables holding data (reference tables are re-seeded, not cleared by order). */
const DATA_TABLES = [
  'generator_readings',
  'dc_readings',
  'dc_phase_currents',
  'battery_readings',
  'battery_unit_readings',
  'solar_readings',
  'non_technical_observations',
  'earthing_readings',
  'pm_photos',
  'pm_readings',
  'pm_responses',
  'pm_visits',
  'pm_schedules',
  'pm_reading_fields',
  'pm_checklist_items',
  'pm_sections',
  'pm_templates',
  'pm_consistency_rules',
  'refresh_tokens',
  'site_assignments',
  'user_region_scopes',
  'user_roles',
  'sites',
  'counties',
  'clusters',
  'regions',
  'users',
];

export function testPrisma(): PrismaService {
  return new PrismaService(testConfig() as AppConfig);
}

/**
 * Empties the data tables (one connection, FK checks off) and re-seeds roles,
 * permissions and the reference template. TRUNCATE, because the template
 * triggers (rightly) refuse row deletes from active template versions.
 */
export async function resetData(prisma: PrismaService): Promise<void> {
  assertTestDatabase(process.env.TEST_DATABASE_URL);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of DATA_TABLES) await tx.$executeRawUnsafe(`TRUNCATE TABLE \`${t}\``);
    await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');
  });
  await seedReferenceData(prisma);
  await seedReferenceTemplate(prisma);
}
