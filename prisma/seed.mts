/**
 * Reference data: permissions, system roles and the reference PM template.
 * Idempotent; runs on every deployment (`pnpm db:seed`). Contains no demo or
 * operational records.
 */
import 'dotenv/config';
import { createPrismaClient } from '../apps/api/src/prisma/create-client.js';
import { seedReferenceData } from '../apps/api/src/seed/reference.js';
import { seedReferenceTemplate } from '../apps/api/src/seed/reference-template.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set.');
const prisma = createPrismaClient(url);
try {
  const r = await seedReferenceData(prisma);
  console.log(`Permissions: ${r.permissions}; system roles: ${r.roles}; grants added ${r.grantsAdded}, removed ${r.grantsRemoved}.`);
  const t = await seedReferenceTemplate(prisma);
  console.log(`Reference PM template: ${t.templateCreated ? 'created (version 1, active)' : 'already present, unchanged'}; consistency rules added: ${t.rulesCreated}.`);
  if (r.obsoletePermissions.length) console.warn(`Permissions in the database but no longer in the catalogue: ${r.obsoletePermissions.join(', ')}`);
} finally {
  await prisma.$disconnect();
}
