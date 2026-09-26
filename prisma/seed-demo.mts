/**
 * DEMO DATA (Tienii 1301 report) for development, training and test
 * environments: `pnpm db:seed:demo`. Refused when NODE_ENV=production.
 * Remove with `pnpm db:seed:demo --remove`.
 */
import 'dotenv/config';
import { createPrismaClient } from '../apps/api/src/prisma/create-client.js';
import { removeDemoData, seedDemoData } from '../apps/api/src/seed/demo.js';
import { seedReferenceData } from '../apps/api/src/seed/reference.js';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to load demo data with NODE_ENV=production.');
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set.');
const prisma = createPrismaClient(url);
try {
  if (process.argv.includes('--remove')) {
    console.log('Removed demo records:', await removeDemoData(prisma));
  } else {
    await seedReferenceData(prisma);
    const r = await seedDemoData(prisma);
    console.log('Demo data loaded (flagged is_demo):', r);
  }
} finally {
  await prisma.$disconnect();
}
