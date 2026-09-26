import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { rethrowDbError } from '../src/common/prisma-errors.js';
import { resetData, testPrisma } from './db.js';
import { expectAppError, makeOrg, services } from './fixtures.js';

const prisma = testPrisma();
const { org } = services(prisma);
afterAll(() => prisma.$disconnect());
beforeEach(() => resetData(prisma));

describe('migrations', () => {
  it('every migration in the repository is applied and finished', async () => {
    const dir = fileURLToPath(new URL('../../../prisma/migrations', import.meta.url));
    const onDisk = readdirSync(dir).filter((d) => /^\d{14}_/.test(d));
    const applied = await prisma.$queryRaw<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]>`
      SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations`;
    expect(applied.map((m) => m.migration_name).sort()).toEqual(onDisk.sort());
    expect(applied.every((m) => m.finished_at && !m.rolled_back_at)).toBe(true);
  });
});

/** Rules MySQL enforces even when the API's own checks are bypassed. */
describe('database-level rules', () => {
  const direct = (p: Promise<unknown>) => p.catch(rethrowDbError);

  it("a site's cluster must belong to its region and its county to its cluster (triggers)", async () => {
    const a = await makeOrg(org);
    const b = await makeOrg(org);
    await expectAppError(direct(prisma.site.create({ data: { siteCode: 'X1', siteName: 'x', regionId: b.region.id, clusterId: a.cluster.id } })), 422, 'HIERARCHY_MISMATCH');
    await expectAppError(direct(prisma.site.create({ data: { siteCode: 'X2', siteName: 'x', regionId: a.region.id, countyId: a.county.id } })), 422, 'HIERARCHY_MISMATCH');
    const ok = await prisma.site.create({ data: { siteCode: 'X3', siteName: 'x', regionId: a.region.id, clusterId: a.cluster.id, countyId: a.county.id } });
    await expectAppError(direct(prisma.site.update({ where: { id: ok.id }, data: { regionId: b.region.id } })), 422, 'HIERARCHY_MISMATCH');
    // A cluster or county in use cannot be moved under the sites' feet.
    await expectAppError(direct(prisma.cluster.update({ where: { id: a.cluster.id }, data: { regionId: b.region.id } })), 422, 'HIERARCHY_MISMATCH');
    await expectAppError(direct(prisma.county.update({ where: { id: a.county.id }, data: { clusterId: b.cluster.id } })), 422, 'HIERARCHY_MISMATCH');
  });

  it('coordinates are in range and come in pairs; assignment dates are ordered (CHECK constraints)', async () => {
    const { region } = await makeOrg(org);
    await expectAppError(direct(prisma.site.create({ data: { siteCode: 'L1', siteName: 'x', regionId: region.id, latitude: 91, longitude: 0 } })), 422, 'INVALID_VALUE');
    await expectAppError(direct(prisma.site.create({ data: { siteCode: 'L2', siteName: 'x', regionId: region.id, latitude: 6.5 } })), 422, 'INVALID_VALUE');
    const site = await prisma.site.create({ data: { siteCode: 'L3', siteName: 'x', regionId: region.id } });
    const user = await prisma.user.create({ data: { email: 'a@example.com', fullName: 'A' } });
    await expectAppError(
      direct(prisma.siteAssignment.create({ data: { siteId: site.id, userId: user.id, role: 'TECHNICIAN', startDate: new Date('2026-09-10'), endDate: new Date('2026-09-01'), active: false } })),
      422,
      'INVALID_VALUE',
    );
    await expectAppError(
      direct(prisma.siteAssignment.create({ data: { siteId: site.id, userId: user.id, role: 'TECHNICIAN', startDate: new Date('2026-09-10'), active: false } })),
      422,
      'INVALID_VALUE',
    );
  });

  it('site codes and emails are unique regardless of case; emails are stored lower-case', async () => {
    const { region } = await makeOrg(org);
    await prisma.site.create({ data: { siteCode: 'TN-01', siteName: 'x', regionId: region.id } });
    const dup = await expectAppError(direct(prisma.site.create({ data: { siteCode: 'tn-01', siteName: 'y', regionId: region.id } })), 409, 'ALREADY_EXISTS');
    expect(dup.details).toEqual({ field: 'siteCode' });
    await expectAppError(direct(prisma.user.create({ data: { email: 'Mixed@Example.com', fullName: 'M' } })), 422, 'INVALID_VALUE');
  });

  it('references must exist and records in use cannot be deleted', async () => {
    const a = await makeOrg(org);
    await expectAppError(direct(prisma.site.create({ data: { siteCode: 'F1', siteName: 'x', regionId: '00000000-0000-7000-8000-000000000000' } })), 422, 'INVALID_REFERENCE');
    await expectAppError(direct(prisma.region.delete({ where: { id: a.region.id } })), 409, 'IN_USE');
  });
});
