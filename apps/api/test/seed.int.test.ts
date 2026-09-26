import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PERMISSIONS, SYSTEM_ROLES } from '../src/authz/catalog.js';
import { DEMO, removeDemoData, seedDemoData } from '../src/seed/demo.js';
import { createFirstAdmin } from '../src/seed/first-admin.js';
import { seedReferenceData } from '../src/seed/reference.js';
import { seedReferenceTemplate } from '../src/seed/reference-template.js';
import { resetData, testPrisma } from './db.js';
import { makeOrg, services } from './fixtures.js';

const prisma = testPrisma();
afterAll(() => prisma.$disconnect());
beforeEach(() => resetData(prisma));

const matrix = async () => {
  const roles = await prisma.role.findMany({ include: { permissions: { include: { permission: true } } } });
  return Object.fromEntries(roles.map((r) => [r.code, r.permissions.map((p) => p.permission.code).sort()]));
};

describe('reference seed (roles and permissions)', () => {
  it('writes exactly the catalogue: every permission, the six system roles and their grants', async () => {
    expect(await prisma.permission.count()).toBe(Object.keys(PERMISSIONS).length);
    const expected = Object.fromEntries(Object.entries(SYSTEM_ROLES).map(([code, def]) => [code, [...def.permissions].sort()]));
    expect(await matrix()).toEqual(expected);
    expect((await prisma.role.findMany({ orderBy: { sortOrder: 'asc' } })).map((r) => r.code)).toEqual([
      'SUPER_ADMIN',
      'REGIONAL_MANAGER',
      'REGIONAL_SUPERVISOR',
      'TECHNICIAN',
      'MAINTENANCE_USER',
      'VIEWER',
    ]);
  });

  it('is idempotent and repairs drift in system-role grants', async () => {
    expect(await seedReferenceData(prisma)).toMatchObject({ grantsAdded: 0, grantsRemoved: 0 });
    const viewer = await prisma.role.findUniqueOrThrow({ where: { code: 'VIEWER' } });
    const manage = await prisma.permission.findUniqueOrThrow({ where: { code: 'sites.manage' } });
    await prisma.rolePermission.create({ data: { roleId: viewer.id, permissionId: manage.id } }); // stray grant
    await prisma.rolePermission.deleteMany({ where: { roleId: viewer.id, permission: { code: 'sites.read' } } }); // missing grant
    expect(await seedReferenceData(prisma)).toMatchObject({ grantsAdded: 1, grantsRemoved: 1 });
    expect((await matrix()).VIEWER).toEqual([...SYSTEM_ROLES.VIEWER.permissions].sort());
  });

  it('read-only roles hold no permission that changes data', async () => {
    const m = await matrix();
    const writes = (codes: string[]) => codes.filter((c) => /\.(manage|perform|review|report|work)$/.test(c));
    expect(writes(m.VIEWER!)).toEqual([]);
    expect(writes(m.REGIONAL_MANAGER!)).toEqual([]);
  });
});

describe('demo seed (Tienii 1301)', () => {
  it('loads only the facts in the report, flagged as demo, with a technician who cannot sign in', async () => {
    await seedDemoData(prisma);
    const site = await prisma.site.findUniqueOrThrow({ where: { siteCode: '1301' }, include: { region: true, assignments: { include: { user: true } } } });
    expect(site).toMatchObject({ siteName: 'Tienii', isDemo: true, clusterId: null, countyId: null, latitude: null, generatorAvailable: true, solarAvailable: false });
    expect(site.region).toMatchObject({ code: 'GCM', name: 'Grand Cape Mount', isDemo: true });
    expect(site.assignments).toHaveLength(1);
    expect(site.assignments[0]).toMatchObject({ role: 'TECHNICIAN', isDemo: true, active: true });
    expect(site.assignments[0]!.user).toMatchObject({ fullName: 'Abraham Cole', email: DEMO.technicianEmail, isDemo: true, passwordHash: null });
  });

  it('is idempotent', async () => {
    const a = await seedDemoData(prisma);
    const b = await seedDemoData(prisma);
    expect(b).toEqual(a);
    expect(await prisma.siteAssignment.count()).toBe(1);
  });

  it('never takes over an operational site with the same code', async () => {
    const { org } = services(prisma);
    const { region } = await makeOrg(org);
    await org.createSite({ siteCode: '1301', siteName: 'Real site', regionId: region.id }, null);
    await expect(seedDemoData(prisma)).rejects.toThrow(/operational data/);
    expect((await prisma.site.findUniqueOrThrow({ where: { siteCode: '1301' } })).siteName).toBe('Real site');
  });

  it('removal deletes the demo records and nothing else', async () => {
    const { org, users } = services(prisma);
    const real = await makeOrg(org);
    const realSite = await org.createSite({ siteCode: 'REAL-1', siteName: 'Real', countyId: real.county.id }, null);
    const realUser = await users.createUser({ email: 'real@example.com', fullName: 'Real Tech', roles: ['TECHNICIAN'] }, null);
    await seedDemoData(prisma);
    const removed = await removeDemoData(prisma);
    expect(removed).toMatchObject({ assignments: 1, users: 1, sites: 1, regions: 1 });
    expect(await prisma.site.findMany({ select: { id: true } })).toEqual([{ id: realSite.id }]);
    expect(await prisma.user.findMany({ select: { id: true } })).toEqual([{ id: realUser.id }]);
    expect(await prisma.region.count()).toBe(1);
  });
});

describe('first Super Admin (installation bootstrap)', () => {
  it('creates one Super Admin with an Argon2id hash, then refuses a second', async () => {
    const admin = await createFirstAdmin(prisma, { email: ' Admin@IPT-Example.com ', fullName: 'First Admin', password: 'a-long-first-password' });
    const row = await prisma.user.findUniqueOrThrow({ where: { id: admin.id }, include: { roles: { include: { role: true } } } });
    expect(row.email).toBe('admin@ipt-example.com');
    expect(row.passwordHash).toMatch(/^\$argon2id\$/);
    expect(row.mustChangePassword).toBe(false);
    expect(row.roles.map((r) => r.role.code)).toEqual(['SUPER_ADMIN']);
    await expect(createFirstAdmin(prisma, { email: 'second@example.com', fullName: 'Second', password: 'a-long-first-password' })).rejects.toThrow(/already exists/);
  });

  it('validates the input', async () => {
    await expect(createFirstAdmin(prisma, { email: 'x@example.com', fullName: 'X', password: 'short' })).rejects.toThrow(/at least 12/);
    await expect(createFirstAdmin(prisma, { email: 'not-an-email', fullName: 'X', password: 'a-long-first-password' })).rejects.toThrow(/e-mail/);
    await expect(createFirstAdmin(prisma, { email: 'long.address@example.com', fullName: 'X', password: 'long.address@example.com' })).rejects.toThrow(/must not be/);
    expect(await prisma.user.count()).toBe(0);
  });
});

describe('reference PM template seed', () => {
  it('creates version 1 once and never changes it afterwards', async () => {
    // resetData already seeded it.
    const again = await seedReferenceTemplate(prisma);
    expect(again).toEqual({ templateCreated: false, rulesCreated: 0 });
    const t = await prisma.pmTemplate.findMany({ include: { _count: { select: { sections: true } } } });
    expect(t.map((x) => [x.code, x.version, x.status, x._count.sections])).toEqual([['TELECOM_SITE_POWER_PM', 1, 'ACTIVE', 6]]);
    expect(await prisma.pmChecklistItem.count()).toBe(69);
    expect(await prisma.pmReadingField.count()).toBe(16);
    expect(await prisma.pmConsistencyRule.count()).toBe(3);
    // No engineering limits: only definitional bounds (≥ 0, percent ≤ 100).
    const maxima = await prisma.pmReadingField.findMany({ where: { maxValue: { not: null } }, select: { code: true, maxValue: true } });
    expect(maxima.map((m) => [m.code, Number(m.maxValue)])).toEqual([['fuel_level', 100]]);
  });
});
