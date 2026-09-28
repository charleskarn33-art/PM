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
let as: Record<'admin' | 'supervisorA' | 'supervisorB' | 'tech1' | 'viewerA', As>;
let ids: Record<'regionA' | 'regionB' | 'siteA1' | 'siteB' | 'tech1' | 'tech2', string>;

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
  const siteB = await org.createSite({ siteCode: 'B-1', siteName: 'Bravo', regionId: b.region.id, generatorAvailable: true }, null);
  const make = async (roles: string[], extra: Record<string, unknown> = {}) => {
    const u = await makeUser(users, roles, extra);
    await setPassword(prisma, u.id);
    return u;
  };
  const admin = await make(['SUPER_ADMIN']);
  const supervisorA = await make(['REGIONAL_SUPERVISOR'], { regionScopeIds: [a.region.id] });
  const supervisorB = await make(['REGIONAL_SUPERVISOR'], { regionScopeIds: [b.region.id] });
  const viewerA = await make(['VIEWER'], { regionScopeIds: [a.region.id] });
  const tech1 = await make(['TECHNICIAN'], { fullName: 'Tech One', homeRegionId: a.region.id });
  const tech2 = await make(['TECHNICIAN'], { fullName: 'Tech Two', homeRegionId: b.region.id });
  await assignments.assign({ siteId: siteA1.id, userId: tech1.id, role: 'TECHNICIAN', startDate: '2026-01-01' }, admin.id);
  await assignments.assign({ siteId: siteB.id, userId: tech2.id, role: 'TECHNICIAN', startDate: '2026-01-01' }, admin.id);
  ids = { regionA: a.region.id, regionB: b.region.id, siteA1: siteA1.id, siteB: siteB.id, tech1: tech1.id, tech2: tech2.id };
  as = {
    admin: await signIn(http, admin.email),
    supervisorA: await signIn(http, supervisorA.email),
    supervisorB: await signIn(http, supervisorB.email),
    tech1: await signIn(http, tech1.email),
    viewerA: await signIn(http, viewerA.email),
  };
});

const today = () => app.get(SchedulesService).today();
const shift = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** Months covering every date the scenario uses. */
const span = () => `from=${shift(today(), -10).slice(0, 7)}&to=${shift(today(), 30).slice(0, 7)}`;

/** Region A: one PM done on time (with a failure), one overdue, one open; region B: one open. */
async function scenario() {
  const t = today();
  const mk = (who: As, siteId: string, technicianId: string, scheduledDate: string, dueDate: string) =>
    who.post('/pm-schedules', { siteId, technicianId, scheduledDate, dueDate }).expect(201).then((r) => r.body.data[0] as { id: string });
  const done = await mk(as.supervisorA, ids.siteA1, ids.tech1, t, t);
  const visitId = await completePm(as.tech1, { scheduleId: done.id, failing: ['gen_automation_working'] });
  await mk(as.supervisorA, ids.siteA1, ids.tech1, shift(t, -20), shift(t, -10));
  await mk(as.supervisorA, ids.siteA1, ids.tech1, t, shift(t, 30));
  await mk(as.supervisorB, ids.siteB, ids.tech2, t, shift(t, 5));
  return { visitId };
}

describe('completion', () => {
  it('counts due, completed, on time and overdue per region, and a monthly trend', async () => {
    await scenario();
    const d = (await as.admin.get(`/analytics/completion?${span()}`).expect(200)).body.data;
    expect(d.targetPct).toBeNull();
    expect(d.total).toMatchObject({ due: 4, completed: 1, onTime: 1, late: 0, overdue: 1, open: 2, ratePct: 25, belowTarget: null });
    const a = d.groups.find((g: { id: string }) => g.id === ids.regionA);
    expect(a).toMatchObject({ name: 'Region A', due: 3, completed: 1, onTime: 1, overdue: 1, open: 1, ratePct: 33.3, onTimePct: 33.3 });
    expect(d.groups.find((g: { id: string }) => g.id === ids.regionB)).toMatchObject({ due: 1, completed: 0, open: 1, ratePct: 0 });
    // The trend adds up to the total, month by month.
    const sum = d.trend.reduce((n: number, m: { due: number }) => n + m.due, 0);
    expect(sum).toBe(4);
    expect(d.trend.find((m: { month: string }) => m.month === today().slice(0, 7)).completed).toBe(1);
  });

  it('by technician and by county; scoped to the caller', async () => {
    await scenario();
    const tech = (await as.admin.get(`/analytics/completion?${span()}&by=technician`).expect(200)).body.data.groups;
    expect(tech.map((g: { name: string; due: number }) => [g.name, g.due])).toEqual([
      ['Tech Two', 1],
      ['Tech One', 3],
    ]);
    const county = (await as.admin.get(`/analytics/completion?${span()}&by=county`).expect(200)).body.data.groups;
    expect(county).toEqual([expect.objectContaining({ id: null, name: 'No county', due: 4 })]);
    const mine = (await as.supervisorA.get(`/analytics/completion?${span()}`).expect(200)).body.data;
    expect(mine.groups.map((g: { id: string }) => g.id)).toEqual([ids.regionA]);
    expect(mine.total.due).toBe(3);
    expect((await as.viewerA.get(`/analytics/completion?${span()}&regionId=${ids.regionB}`).expect(200)).body.data.total.due).toBe(0);
    await as.tech1.get('/analytics/completion').expect(403);
  });

  it('marks groups below a configured target only', async () => {
    await scenario();
    await as.admin.put('/settings/thresholds', { ...(await thresholds()), completionTargetPct: 150 }).expect(422);
    await as.admin.put('/settings/thresholds', { completionTargetPct: 30 }).expect(422);
    await as.supervisorA.put('/settings/thresholds', await thresholds()).expect(403);
    await as.admin.put('/settings/thresholds', { ...(await thresholds()), completionTargetPct: 30 }).expect(200);
    const d = (await as.admin.get(`/analytics/completion?${span()}`).expect(200)).body.data;
    expect(d.targetPct).toBe(30);
    expect(d.groups.map((g: { id: string; belowTarget: boolean }) => [g.id, g.belowTarget])).toEqual([
      [ids.regionB, true],
      [ids.regionA, false],
    ]);
  });

  it('rejects bad ranges', async () => {
    await as.admin.get('/analytics/completion?from=2026-09&to=2026-01').expect(422);
    await as.admin.get('/analytics/completion?from=2024-01&to=2026-01').expect(422);
    await as.admin.get('/analytics/completion?from=2026-13').expect(422);
    await as.admin.get('/analytics/completion?by=site').expect(422);
    const d = (await as.admin.get('/analytics/completion').expect(200)).body.data;
    expect(d.range.months).toHaveLength(6);
    expect(d.range.to).toBe(today().slice(0, 7));
  });
});

const thresholds = async () => (await as.admin.get('/settings').expect(200)).body.data.thresholds as Record<string, number | null>;

describe('power', () => {
  it('reports readings of finished visits only, with no flags until thresholds are set', async () => {
    const { visitId } = await scenario();
    // A visit still in progress: its readings are not counted.
    const open = (await as.tech1.post('/visits', { siteId: ids.siteA1 }).expect(201)).body.data;
    const readings = open.sections.flatMap((s: { readingFields: { id: string; valueType: string }[] }) =>
      s.readingFields.filter((f) => f.valueType === 'NUMBER').map((f) => ({ readingFieldId: f.id, numericValue: 99 })),
    );
    await as.tech1.put(`/visits/${open.id}/answers`, { responses: [], readings }).expect(200);
    expect(await prisma.dcReading.count({ where: { visitId: open.id } })).toBe(1);

    const d = (await as.supervisorA.get('/analytics/power').expect(200)).body.data;
    expect(d.thresholds).toEqual(await thresholds());
    expect(d.dc).toMatchObject({ readings: 1, sitesReported: 1, sitesFlagged: 0 });
    expect(d.dc.sites[0]).toMatchObject({ visitId, site: { siteCode: 'A-1' }, flags: [] });
    expect(d.battery).toMatchObject({ readings: 1, sitesFlagged: 0 });
    expect(d.generator).toMatchObject({ readings: 1, sitesFlagged: 0 });
    expect(d.dc.trend).toHaveLength(6);
    expect(d.dc.trend.at(-1)).toMatchObject({ month: today().slice(0, 7), readings: 1 });
    expect(d.dc.trend[0]).toMatchObject({ readings: 0, avgDcPowerKw: null });

    const dc = d.dc.sites[0];
    const bat = d.battery.sites[0];
    const gen = d.generator.sites[0];
    await as.admin
      .put('/settings/thresholds', {
        ...(await thresholds()),
        dcLoadKwMax: dc.dcPowerKw - 0.001,
        batteryVoltageMin: bat.batteryVoltageV + 1,
        fuelLevelMinPct: gen.fuelLevelPct == null ? null : gen.fuelLevelPct - 1,
      })
      .expect(200);
    const f = (await as.supervisorA.get('/analytics/power').expect(200)).body.data;
    expect(f.dc.sites[0].flags).toEqual(['DC_LOAD_HIGH']);
    expect(f.battery.sites[0].flags).toEqual(['BATTERY_VOLTAGE_LOW']);
    expect(f.generator.sites[0].flags).toEqual([]);
    expect(f.dc.sitesFlagged).toBe(1);

    expect((await as.supervisorB.get('/analytics/power').expect(200)).body.data.dc.readings).toBe(0);
    expect((await as.admin.get(`/analytics/power?siteId=${ids.siteB}`).expect(200)).body.data.dc.readings).toBe(0);
    await as.tech1.get('/analytics/power').expect(403);
  });
});

describe('failures', () => {
  it('monthly detected and closed, by severity, category, site and checklist item', async () => {
    await scenario();
    const d = (await as.supervisorA.get('/analytics/failures').expect(200)).body.data;
    expect(d).toMatchObject({ detected: 1, closed: 0, openNow: 1, timeToClose: { count: 0, meanDays: null, medianDays: null } });
    expect(d.bySeverity).toEqual({ LOW: 0, MEDIUM: 1, HIGH: 0, CRITICAL: 0 });
    expect(d.byCategory).toMatchObject({ GENERATOR: 1, BATTERY: 0, UNSPECIFIED: 0 });
    expect(d.topSites).toEqual([expect.objectContaining({ site: expect.objectContaining({ siteCode: 'A-1' }), count: 1, open: 1 })]);
    expect(d.topItems).toEqual([expect.objectContaining({ code: 'gen_automation_working', count: 1 })]);
    expect(d.trend.at(-1)).toEqual({ month: today().slice(0, 7), detected: 1, closed: 0 });

    const [failure] = (await as.supervisorA.get('/failures').expect(200)).body.data;
    await as.supervisorA.post(`/failures/${failure.id}/close`, { note: 'Fixed during the visit.' }).expect(200);
    const c = (await as.supervisorA.get('/analytics/failures').expect(200)).body.data;
    expect(c).toMatchObject({ detected: 1, closed: 1, openNow: 0, timeToClose: { count: 1 } });
    expect(c.timeToClose.meanDays).toBeGreaterThanOrEqual(0);

    expect((await as.supervisorB.get('/analytics/failures').expect(200)).body.data).toMatchObject({ detected: 0, openNow: 0, topSites: [] });
  });
});
