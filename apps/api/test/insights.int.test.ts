import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AssignmentsService } from '../src/assignments/assignments.service.js';
import { OrganisationService } from '../src/organisation/organisation.service.js';
import { SchedulesService } from '../src/pm/schedules.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { UsersService } from '../src/users/users.service.js';
import { resetData } from './db.js';
import { makeOrg, makeUser } from './fixtures.js';
import { setPassword, signIn, type Http } from './http.js';
import { completePm } from './pm-helpers.js';
import { startApp, testConfig } from './support.js';

let app: NestExpressApplication;
let http: Http;
let prisma: PrismaService;
type As = Awaited<ReturnType<typeof signIn>>;
let as: Record<'admin' | 'supervisorA' | 'supervisorB' | 'tech1' | 'tech2' | 'viewerA', As>;
let ids: Record<'regionA' | 'siteA1' | 'siteA2' | 'siteB' | 'tech1' | 'tech2' | 'supervisorA' | 'supervisorB', string>;

beforeAll(async () => {
  app = await startApp(testConfig({ AUTH_RATE_LIMIT_PER_MINUTE: '1000', RATE_LIMIT_PER_MINUTE: '100000' }), false);
  http = app.getHttpServer();
  prisma = app.get(PrismaService);
});
afterAll(() => app?.close());

beforeEach(async () => {
  await resetData(prisma);
  const org = app.get(OrganisationService);
  const users = app.get(UsersService);
  const assignments = app.get(AssignmentsService);
  const a = await makeOrg(org, 'A');
  const b = await makeOrg(org, 'B');
  const siteA1 = await org.createSite({ siteCode: 'A-1', siteName: 'Alpha one', regionId: a.region.id, generatorAvailable: true }, null);
  const siteA2 = await org.createSite({ siteCode: 'A-2', siteName: 'Alpha two', regionId: a.region.id, status: 'INACTIVE' }, null);
  const siteB = await org.createSite({ siteCode: 'B-1', siteName: 'Bravo', regionId: b.region.id }, null);
  const make = async (roles: string[], extra: Record<string, unknown> = {}) => {
    const u = await makeUser(users, roles, extra);
    await setPassword(prisma, u.id);
    return u;
  };
  const admin = await make(['SUPER_ADMIN']);
  const supervisorA = await make(['REGIONAL_SUPERVISOR'], { regionScopeIds: [a.region.id], fullName: 'Supervisor Alpha' });
  const supervisorB = await make(['REGIONAL_SUPERVISOR'], { regionScopeIds: [b.region.id] });
  const viewerA = await make(['VIEWER'], { regionScopeIds: [a.region.id] });
  const tech1 = await make(['TECHNICIAN'], { fullName: 'Tech One', homeRegionId: a.region.id });
  const tech2 = await make(['TECHNICIAN'], { fullName: 'Tech Two', homeRegionId: b.region.id });
  await assignments.assign({ siteId: siteA1.id, userId: tech1.id, role: 'TECHNICIAN', startDate: '2026-09-01' }, admin.id);
  await assignments.assign({ siteId: siteA1.id, userId: supervisorA.id, role: 'SUPERVISOR', startDate: '2026-09-01' }, admin.id);
  await assignments.assign({ siteId: siteB.id, userId: tech2.id, role: 'TECHNICIAN', startDate: '2026-09-01' }, admin.id);
  ids = { regionA: a.region.id, siteA1: siteA1.id, siteA2: siteA2.id, siteB: siteB.id, tech1: tech1.id, tech2: tech2.id, supervisorA: supervisorA.id, supervisorB: supervisorB.id };
  as = {
    admin: await signIn(http, admin.email),
    supervisorA: await signIn(http, supervisorA.email),
    supervisorB: await signIn(http, supervisorB.email),
    tech1: await signIn(http, tech1.email),
    tech2: await signIn(http, tech2.email),
    viewerA: await signIn(http, viewerA.email),
  };
});

const today = () => app.get(SchedulesService).today();
const shift = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Region A: one PM completed with a failure (and an action on it), one overdue PM, one open PM; region B: one open PM. */
async function scenario() {
  const t = today();
  const mk = (who: As, siteId: string, technicianId: string, scheduledDate: string, dueDate: string) =>
    who.post('/pm-schedules', { siteId, technicianId, scheduledDate, dueDate }).expect(201).then((r) => r.body.data[0] as { id: string });
  const done = await mk(as.supervisorA, ids.siteA1, ids.tech1, t, t);
  const visitId = await completePm(as.tech1, { scheduleId: done.id, failing: ['gen_automation_working'] });
  const overdue = await mk(as.supervisorA, ids.siteA1, ids.tech1, shift(t, -20), shift(t, -10));
  await mk(as.supervisorA, ids.siteA1, ids.tech1, t, shift(t, 30));
  await mk(as.supervisorB, ids.siteB, ids.tech2, t, shift(t, 5));
  const [failure] = (await as.supervisorA.get(`/failures?visitId=${visitId}`).expect(200)).body.data;
  await as.supervisorA.post('/corrective-actions', { failureId: failure.id, title: 'Replace ATS controller', assignedToId: ids.tech1, dueDate: shift(t, -1) }).expect(201);
  return { visitId, overdueId: overdue.id, failureId: failure.id as string };
}

describe('dashboard', () => {
  it('counts what is in the caller’s scope, exactly', async () => {
    const { visitId } = await scenario();
    const d = (await as.supervisorA.get('/dashboard').expect(200)).body.data;
    expect(d.sites).toEqual({ total: 2, active: 1, demo: 0 });
    expect(d.pm).toMatchObject({ overdue: 1, inProgress: 0, awaitingReview: 1, returnedForCorrection: 0 });
    // Due this month in region A: the completed one (due today) and possibly the one due in 30 days / the overdue one, depending on the date.
    const month = today().slice(0, 7);
    const dueDates = [today(), shift(today(), -10), shift(today(), 30)].filter((x) => x.startsWith(month));
    expect(d.pm.dueThisMonth).toBe(dueDates.length);
    expect(d.pm.completedThisMonth).toBe(1);
    expect(d.pm.completionRatePct).toBe(Math.round(1000 / dueDates.length) / 10);
    expect(d.failures).toEqual({ open: 1, bySeverity: { LOW: 0, MEDIUM: 1, HIGH: 0, CRITICAL: 0 }, byCategory: { GENERATOR: 1 }, newLast30Days: 1 });
    expect(d.correctiveActions).toEqual({ active: 1, overdue: 1, awaitingVerification: 0 });
    expect(d.recentVisits.map((v: { id: string }) => v.id)).toEqual([visitId]);
    expect(d.recentFailures[0]).toMatchObject({ number: 'FL-000001', site: { siteCode: 'A-1' } });

    const b = (await as.supervisorB.get('/dashboard').expect(200)).body.data;
    expect(b).toMatchObject({ sites: { total: 1, active: 1 }, pm: { overdue: 0, awaitingReview: 0 }, failures: { open: 0 }, correctiveActions: { active: 0 } });
    expect((await as.admin.get('/dashboard').expect(200)).body.data.sites).toEqual({ total: 3, active: 2, demo: 0 });
    await as.tech1.get('/dashboard').expect(403);
  });
});

describe('sites overview', () => {
  it('lists who works at each site and where its PM stands; filters by supervisor and PM state', async () => {
    await scenario();
    const list = (await as.supervisorA.get('/sites').expect(200)).body.data;
    const a1 = list.find((s: { siteCode: string }) => s.siteCode === 'A-1');
    expect(a1.overview).toMatchObject({
      technicians: [{ id: ids.tech1, fullName: 'Tech One' }],
      supervisor: { id: ids.supervisorA },
      nextPm: { status: 'OVERDUE', dueDate: shift(today(), -10) },
      openFailures: 1,
      openActions: 1,
    });
    expect(a1.overview.lastPmAt).toBeTruthy();
    expect(list.find((s: { siteCode: string }) => s.siteCode === 'A-2').overview).toMatchObject({ technicians: [], supervisor: null, nextPm: null, lastPmAt: null, openFailures: 0 });
    const codes = async (qs: string) => (await as.supervisorA.get(`/sites?${qs}`).expect(200)).body.data.map((s: { siteCode: string }) => s.siteCode);
    expect(await codes('pm=overdue')).toEqual(['A-1']);
    expect(await codes('pm=none')).toEqual(['A-2']);
    expect(await codes(`supervisorId=${ids.supervisorA}`)).toEqual(['A-1']);
    expect(await codes('sort=siteName&dir=desc')).toEqual(['A-2', 'A-1']);
    expect((await as.supervisorA.get(`/sites/${ids.siteA1}`).expect(200)).body.data.overview.openFailures).toBe(1);
  });
});

describe('people', () => {
  it('technicians with their workload, within scope', async () => {
    await scenario();
    const list = (await as.supervisorA.get('/people?role=TECHNICIAN').expect(200)).body.data;
    expect(list.map((u: { fullName: string }) => u.fullName)).toEqual(['Tech One']);
    expect(list[0].workload).toEqual({ assignedSites: 1, openPms: 2, overduePms: 1, completedLast30Days: 1, lastVisitAt: expect.any(String), openActions: 1, overdueActions: 1 });
    const all = (await as.admin.get('/people?role=TECHNICIAN').expect(200)).body.data;
    expect(all.map((u: { fullName: string }) => u.fullName)).toEqual(['Tech One', 'Tech Two']);
    expect(all[1].workload).toMatchObject({ assignedSites: 1, openPms: 1, overduePms: 0, completedLast30Days: 0, lastVisitAt: null });
    await as.tech1.get('/people?role=TECHNICIAN').expect(403);
  });

  it('supervisors with what waits for them', async () => {
    await scenario();
    const list = (await as.admin.get('/people?role=REGIONAL_SUPERVISOR').expect(200)).body.data;
    const a = list.find((u: { id: string }) => u.id === ids.supervisorA);
    expect(a.workload).toEqual({ supervisedSites: 1, sitesInRegions: 2, awaitingReview: 1, openFailures: 1, actionsToVerify: 0 });
    expect(a.regions.map((r: { id: string }) => r.id)).toEqual([ids.regionA]);
    const b = list.find((u: { id: string }) => u.id === ids.supervisorB);
    expect(b.workload).toEqual({ supervisedSites: 0, sitesInRegions: 1, awaitingReview: 0, openFailures: 0, actionsToVerify: 0 });
  });
});

describe('search', () => {
  it('finds sites, failures, actions and people the caller may see', async () => {
    await scenario();
    const r = (await as.supervisorA.get('/search?q=A-1').expect(200)).body.data;
    expect(r.sites.map((s: { siteCode: string }) => s.siteCode)).toEqual(['A-1']);
    expect((await as.supervisorA.get('/search?q=FL-000001').expect(200)).body.data.failures).toMatchObject([{ number: 'FL-000001' }]);
    expect((await as.supervisorA.get('/search?q=ATS').expect(200)).body.data.correctiveActions).toMatchObject([{ number: 'CA-000001' }]);
    expect((await as.supervisorA.get('/search?q=Tech').expect(200)).body.data.people.map((p: { fullName: string }) => p.fullName)).toEqual(['Tech One']);
    // Out of scope: nothing from region A for region B's supervisor.
    const b = (await as.supervisorB.get('/search?q=A-1').expect(200)).body.data;
    expect(b).toMatchObject({ sites: [], failures: [], correctiveActions: [] });
    // Without users.read, no people.
    expect((await as.tech1.get('/search?q=Tech').expect(200)).body.data.people).toEqual([]);
    await as.viewerA.get('/search?q=x').expect(422);
  });
});
