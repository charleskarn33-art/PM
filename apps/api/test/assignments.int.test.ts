import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetData, testPrisma } from './db.js';
import { expectAppError, makeOrg, makeUser, services } from './fixtures.js';

const prisma = testPrisma();
const { org, users, assignments } = services(prisma);
afterAll(() => prisma.$disconnect());
beforeEach(() => resetData(prisma));

async function setup() {
  const { region } = await makeOrg(org);
  const site = await org.createSite({ siteCode: 'AS-1', siteName: 'Assign me', regionId: region.id }, null);
  return { region, site };
}
const day = (d: Date | null) => d?.toISOString().slice(0, 10);

describe('site assignments', () => {
  it('assigns technicians (several may be active) and records who assigned them', async () => {
    const { site } = await setup();
    const admin = await makeUser(users, ['SUPER_ADMIN']);
    const t1 = await makeUser(users, ['TECHNICIAN']);
    const t2 = await makeUser(users, ['TECHNICIAN']);
    const a = await assignments.assign({ siteId: site.id, userId: t1.id, role: 'TECHNICIAN', startDate: '2026-09-01' }, admin.id);
    expect(a).toMatchObject({ active: true, assignedById: admin.id });
    expect(day(a.startDate)).toBe('2026-09-01');
    await assignments.assign({ siteId: site.id, userId: t2.id, role: 'TECHNICIAN', startDate: '2026-09-01' }, admin.id);
    expect(await assignments.active({ siteId: site.id, role: 'TECHNICIAN' })).toHaveLength(2);
    await expectAppError(assignments.assign({ siteId: site.id, userId: t1.id, role: 'TECHNICIAN', startDate: '2026-09-02' }, null), 409, 'ALREADY_ASSIGNED');
  });

  it('only matching, active people on active sites', async () => {
    const { site, region } = await setup();
    const viewer = await makeUser(users, ['VIEWER']);
    await expectAppError(assignments.assign({ siteId: site.id, userId: viewer.id, role: 'TECHNICIAN', startDate: '2026-09-01' }, null), 422, 'ROLE_MISMATCH');
    await expectAppError(assignments.assign({ siteId: site.id, userId: viewer.id, role: 'SUPERVISOR', startDate: '2026-09-01' }, null), 422, 'ROLE_MISMATCH');
    const tech = await makeUser(users, ['TECHNICIAN']);
    await users.setActive(tech.id, false, null);
    await expectAppError(assignments.assign({ siteId: site.id, userId: tech.id, role: 'TECHNICIAN', startDate: '2026-09-01' }, null), 422, 'USER_INACTIVE');
    const other = await makeUser(users, ['TECHNICIAN']);
    await org.updateSite(site.id, { status: 'DECOMMISSIONED' }, null);
    await expectAppError(assignments.assign({ siteId: site.id, userId: other.id, role: 'TECHNICIAN', startDate: '2026-09-01' }, null), 422, 'SITE_NOT_ACTIVE');
    await expectAppError(assignments.assign({ siteId: site.id, userId: other.id, role: 'TECHNICIAN', startDate: '2026-02-30' }, null), 422, 'VALIDATION_FAILED');
    expect(region).toBeDefined();
  });

  it("a supervisor needs the site's region in scope; a new supervisor replaces the current one, history kept", async () => {
    const { site, region } = await setup();
    const elsewhere = await makeOrg(org);
    const outsider = await makeUser(users, ['REGIONAL_SUPERVISOR'], { regionScopeIds: [elsewhere.region.id] });
    await expectAppError(assignments.assign({ siteId: site.id, userId: outsider.id, role: 'SUPERVISOR', startDate: '2026-09-01' }, null), 422, 'OUT_OF_SCOPE');

    const s1 = await makeUser(users, ['REGIONAL_SUPERVISOR'], { regionScopeIds: [region.id] });
    const s2 = await makeUser(users, ['REGIONAL_SUPERVISOR'], { regionScopeIds: [region.id] });
    await assignments.assign({ siteId: site.id, userId: s1.id, role: 'SUPERVISOR', startDate: '2026-01-01' }, null);
    await expectAppError(assignments.assign({ siteId: site.id, userId: s2.id, role: 'SUPERVISOR', startDate: '2025-12-01' }, null), 422, 'START_BEFORE_CURRENT');
    await assignments.assign({ siteId: site.id, userId: s2.id, role: 'SUPERVISOR', startDate: '2026-09-15' }, null);

    const history = await assignments.history(site.id);
    expect(history.map((h) => [h.user.id, h.active, day(h.startDate), day(h.endDate)])).toEqual([
      [s2.id, true, '2026-09-15', undefined],
      [s1.id, false, '2026-01-01', '2026-09-14'],
    ]);
    expect(history[1]!.endReason).toBe('Replaced by a new supervisor');
  });

  it('two supervisors assigned at the same moment leave exactly one active', async () => {
    const { site, region } = await setup();
    const s1 = await makeUser(users, ['REGIONAL_SUPERVISOR'], { regionScopeIds: [region.id] });
    const s2 = await makeUser(users, ['REGIONAL_SUPERVISOR'], { regionScopeIds: [region.id] });
    await Promise.all([
      assignments.assign({ siteId: site.id, userId: s1.id, role: 'SUPERVISOR', startDate: '2026-09-20' }, null),
      assignments.assign({ siteId: site.id, userId: s2.id, role: 'SUPERVISOR', startDate: '2026-09-20' }, null),
    ]);
    expect(await assignments.active({ siteId: site.id, role: 'SUPERVISOR' })).toHaveLength(1);
    expect(await prisma.siteAssignment.count({ where: { siteId: site.id } })).toBe(2);
  });

  it('ends an assignment once, never before it started', async () => {
    const { site } = await setup();
    const tech = await makeUser(users, ['TECHNICIAN']);
    const a = await assignments.assign({ siteId: site.id, userId: tech.id, role: 'TECHNICIAN', startDate: '2026-09-01' }, null);
    await expectAppError(assignments.end(a.id, { endDate: '2026-08-31' }, null), 422, 'END_BEFORE_START');
    const ended = await assignments.end(a.id, { endDate: '2026-09-30', reason: 'Moved to another cluster' }, null);
    expect(ended).toMatchObject({ active: false, endReason: 'Moved to another cluster' });
    expect(day(ended.endDate)).toBe('2026-09-30');
    await expectAppError(assignments.end(a.id, { endDate: '2026-10-01' }, null), 422, 'ALREADY_ENDED');
    // Re-assigning after the end is allowed and is a new history entry.
    await assignments.assign({ siteId: site.id, userId: tech.id, role: 'TECHNICIAN', startDate: '2026-10-01' }, null);
    expect(await assignments.history(site.id)).toHaveLength(2);
  });
});
