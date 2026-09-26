import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { SYSTEM_ROLES } from '../src/authz/catalog.js';
import { resetData, testPrisma } from './db.js';
import { expectAppError, makeOrg, makeUser, services } from './fixtures.js';

const prisma = testPrisma();
const { org, users, assignments } = services(prisma);
afterAll(() => prisma.$disconnect());
beforeEach(() => resetData(prisma));

describe('users', () => {
  it('stores the email lower-case and rejects the same address in another case', async () => {
    const u = await users.createUser({ email: '  Abraham.Cole@IPT-Example.com ', fullName: 'Abraham Cole', roles: ['TECHNICIAN'] }, null);
    expect(u.email).toBe('abraham.cole@ipt-example.com');
    expect(u).not.toHaveProperty('passwordHash');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).passwordHash).toBeNull();
    const dup = await expectAppError(users.createUser({ email: 'ABRAHAM.COLE@ipt-example.com', fullName: 'X', roles: ['TECHNICIAN'] }, null), 409, 'ALREADY_EXISTS');
    expect(dup.details).toEqual({ field: 'email' });
  });

  it('validates roles, email and fields', async () => {
    await expectAppError(users.createUser({ email: 'a@example.com', fullName: 'A', roles: [] }, null), 422, 'VALIDATION_FAILED');
    await expectAppError(users.createUser({ email: 'a@example.com', fullName: 'A', roles: ['GOD_MODE'] }, null), 422, 'VALIDATION_FAILED');
    await expectAppError(users.createUser({ email: 'not-an-email', fullName: 'A', roles: ['VIEWER'] }, null), 422, 'VALIDATION_FAILED');
    await expectAppError(users.createUser({ email: 'a@example.com', fullName: 'A', roles: ['VIEWER'], passwordHash: 'x' }, null), 422, 'VALIDATION_FAILED');
  });

  it('managers and supervisors need a region scope', async () => {
    const { region } = await makeOrg(org);
    await expectAppError(makeUser(users, ['REGIONAL_SUPERVISOR']), 422, 'SCOPE_REQUIRED');
    const sup = await makeUser(users, ['REGIONAL_SUPERVISOR'], { regionScopeIds: [region.id] });
    await expectAppError(users.setRegionScopes(sup.id, { regionIds: [] }, null), 422, 'SCOPE_REQUIRED');
    await expectAppError(users.setRegionScopes(sup.id, { regionIds: ['00000000-0000-7000-8000-000000000000'] }, null), 422, 'INVALID_REFERENCE');
  });

  it("a technician's line manager must be an active supervisor or manager", async () => {
    const { region } = await makeOrg(org);
    const viewer = await makeUser(users, ['VIEWER'], { regionScopeIds: [region.id] });
    await expectAppError(makeUser(users, ['TECHNICIAN'], { reportsToId: viewer.id }), 422, 'INVALID_LINE_MANAGER');
    const sup = await makeUser(users, ['REGIONAL_SUPERVISOR'], { regionScopeIds: [region.id] });
    const tech = await makeUser(users, ['TECHNICIAN'], { reportsToId: sup.id, homeRegionId: region.id });
    expect(tech.reportsToId).toBe(sup.id);
    await expectAppError(users.updateUser(sup.id, { reportsToId: sup.id }, null), 422, 'INVALID_LINE_MANAGER');
  });

  it('access resolves roles, permissions (union of roles) and region scope', async () => {
    const { region } = await makeOrg(org);
    const tech = await makeUser(users, ['TECHNICIAN']);
    expect((await users.getAccess(tech.id)).permissions).toEqual([...SYSTEM_ROLES.TECHNICIAN.permissions].sort());
    const both = await makeUser(users, ['TECHNICIAN', 'REGIONAL_SUPERVISOR'], { regionScopeIds: [region.id] });
    const access = await users.getAccess(both.id);
    expect(access.roles).toEqual(['REGIONAL_SUPERVISOR', 'TECHNICIAN']);
    expect(access.permissions).toEqual([...new Set([...SYSTEM_ROLES.TECHNICIAN.permissions, ...SYSTEM_ROLES.REGIONAL_SUPERVISOR.permissions])].sort());
    expect(access.regionIds).toEqual([region.id]);
    const changed = await users.setRoles(both.id, { roles: ['VIEWER'] }, null);
    expect(changed.roles).toEqual(['VIEWER']);
    expect(changed.permissions).not.toContain('pm_visits.perform');
  });

  it('the last active Super Admin cannot lose the role or be deactivated', async () => {
    const admin = await makeUser(users, ['SUPER_ADMIN']);
    await expectAppError(users.setRoles(admin.id, { roles: ['VIEWER'] }, null), 422, 'LAST_SUPER_ADMIN');
    await expectAppError(users.setActive(admin.id, false, null), 422, 'LAST_SUPER_ADMIN');
    const second = await makeUser(users, ['SUPER_ADMIN']);
    await users.setActive(admin.id, false, second.id);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).isActive).toBe(false);
  });

  it('deactivation ends the user’s active site assignments and keeps the history', async () => {
    const { region } = await makeOrg(org);
    const site = await org.createSite({ siteCode: 'D-1', siteName: 'x', regionId: region.id }, null);
    const tech = await makeUser(users, ['TECHNICIAN']);
    await assignments.assign({ siteId: site.id, userId: tech.id, role: 'TECHNICIAN', startDate: '2026-01-01' }, null);
    await users.setActive(tech.id, false, null);
    const [a] = await assignments.history(site.id);
    expect(a).toMatchObject({ active: false, endReason: 'User deactivated' });
    expect(a!.endDate).not.toBeNull();
  });
});
