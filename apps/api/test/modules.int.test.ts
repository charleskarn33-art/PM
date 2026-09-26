import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AssignmentsService } from '../src/assignments/assignments.service.js';
import { OrganisationService } from '../src/organisation/organisation.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { UsersService } from '../src/users/users.service.js';
import { resetData } from './db.js';
import { makeOrg, makeUser } from './fixtures.js';
import { setPassword, signIn, type Http } from './http.js';
import { startApp, testConfig } from './support.js';

let app: NestExpressApplication;
let http: Http;
let prisma: PrismaService;
type As = Awaited<ReturnType<typeof signIn>>;
let tech: As;
let supervisorA: As;
let supervisorB: As;
let admin: As;
let sites: Record<'plain' | 'batteries' | 'solar', string>;

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
  const a = await makeOrg(org, 'A');
  const b = await makeOrg(org, 'B');
  const plain = await org.createSite({ siteCode: 'P-1', siteName: 'Plain', regionId: a.region.id, generatorAvailable: true, solarAvailable: false }, null);
  const batteries = await org.createSite({ siteCode: 'P-2', siteName: 'Four batteries', regionId: a.region.id, generatorAvailable: false, batteryUnitCount: 4 }, null);
  const solar = await org.createSite({ siteCode: 'P-3', siteName: 'Solar', regionId: a.region.id, generatorAvailable: true, solarAvailable: true }, null);
  const make = async (roles: string[], extra: Record<string, unknown> = {}) => {
    const u = await makeUser(users, roles, extra);
    await setPassword(prisma, u.id);
    return u;
  };
  const t = await make(['TECHNICIAN']);
  const sa = await make(['REGIONAL_SUPERVISOR'], { regionScopeIds: [a.region.id] });
  const sb = await make(['REGIONAL_SUPERVISOR'], { regionScopeIds: [b.region.id] });
  const ad = await make(['SUPER_ADMIN']);
  for (const site of [plain, batteries, solar]) {
    await app.get(AssignmentsService).assign({ siteId: site.id, userId: t.id, role: 'TECHNICIAN', startDate: '2026-09-01' }, null);
  }
  sites = { plain: plain.id, batteries: batteries.id, solar: solar.id };
  tech = await signIn(http, t.email);
  supervisorA = await signIn(http, sa.email);
  supervisorB = await signIn(http, sb.email);
  admin = await signIn(http, ad.email);
});

interface Visit {
  id: string;
  notApplicableSections: string[];
  sections: { code: string; items: { id: string; code: string }[]; readingFields: { id: string; code: string }[] }[];
  modules: Record<string, Record<string, unknown> | null> & {
    dc: (Record<string, unknown> & { phases: { phaseNumber: number; ampValue: number; comment: string | null }[] }) | null;
    battery: (Record<string, unknown> & { units: { unitNumber: number; voltageV: number }[] }) | null;
  };
  issues: { kind: string; refType: string; refId: string; label: string }[];
  completionPct: number;
  skippedBatteryUnits?: number[];
}

const start = async (siteId: string) => (await tech.post('/visits', { siteId }).expect(201)).body.data as Visit;
const item = (v: Visit, code: string) => v.sections.flatMap((s) => s.items).find((i) => i.code === code)!.id;
const field = (v: Visit, code: string) => v.sections.flatMap((s) => s.readingFields).find((f) => f.code === code)!.id;
const save = async (v: Visit, body: object) => (await tech.put(`/visits/${v.id}/answers`, body).expect(200)).body.data as Visit;

describe('power modules', () => {
  it('generator and DC records follow the answers; kW and total phase current are calculated separately', async () => {
    const v = await start(sites.plain);
    expect(v.notApplicableSections).toEqual(['SOLAR']);
    expect(v.modules.solar).toBeNull();
    expect(v.modules.generator).toMatchObject({ runningHours: null, oilPressure: null });

    const saved = await save(v, {
      readings: [
        { readingFieldId: field(v, 'running_hours'), numericValue: 877 },
        { readingFieldId: field(v, 'oil_pressure'), textValue: 'Okay' },
        { readingFieldId: field(v, 'fuel_level'), numericValue: 12.7 },
        { readingFieldId: field(v, 'generator_kva'), numericValue: 20 },
        { readingFieldId: field(v, 'rectifier_output_voltage'), numericValue: 52.99 },
        { readingFieldId: field(v, 'load_current'), numericValue: 52.7 },
        { readingFieldId: field(v, 'rectifier_module_count'), numericValue: 6 },
        { readingFieldId: field(v, 'dc_modules_installed'), numericValue: 3 },
        { readingFieldId: field(v, 'dc_modules_operational'), numericValue: 3 },
      ],
      responses: [
        { checklistItemId: item(v, 'dc_phase_1_amps'), numericValue: 12.25 },
        { checklistItemId: item(v, 'dc_phase_3_amps'), numericValue: 10.5, comment: 'Measured at breaker 3' },
        { checklistItemId: item(v, 'gen_requires_service'), answer: 'NO' },
        { checklistItemId: item(v, 'nt_fire_extinguisher'), answer: 'YES' },
      ],
    });
    expect(saved.modules.generator).toMatchObject({ runningHours: 877, oilPressure: 'Okay', fuelLevelPct: 12.7, generatorKva: 20, requiresService: false });
    expect(saved.modules.dc).toMatchObject({ rectifierVoltageV: 52.99, loadCurrentA: 52.7, dcPowerKw: 2.792573, rectifierModuleCount: 6, totalPhaseCurrentA: 22.75, phasesRecorded: 2 });
    expect(saved.modules.dc!.phases.map((p) => [p.phaseNumber, p.ampValue, p.comment])).toEqual([
      [1, 12.25, null],
      [3, 10.5, 'Measured at breaker 3'],
    ]);
    expect(saved.modules.nonTechnical).toMatchObject({ fireExtinguisherPresent: true });

    // Clearing a phase removes it; marking a section N/A removes its record.
    const cleared = await save(v, { responses: [{ checklistItemId: item(v, 'dc_phase_3_amps') }], notApplicableSections: ['SOLAR', 'GENERATOR'] });
    expect(cleared.modules.dc!.phases.map((p) => p.phaseNumber)).toEqual([1]);
    expect(cleared.modules.dc).toMatchObject({ totalPhaseCurrentA: 12.25, phasesRecorded: 1 });
    expect(cleared.modules.generator).toBeNull();
    expect(await prisma.generatorReading.count()).toBe(0);
    // The answers themselves are kept (the section can be switched back on).
    const back = await save(v, { notApplicableSections: ['SOLAR'] });
    expect(back.modules.generator).toMatchObject({ runningHours: 877 });
  });

  it('a site without solar has no solar record; a site with solar does', async () => {
    const v = await start(sites.solar);
    expect(v.notApplicableSections).toEqual([]);
    const saved = await save(v, {
      readings: [
        { readingFieldId: field(v, 'panels_installed'), numericValue: 12 },
        { readingFieldId: field(v, 'panels_operational'), numericValue: 11 },
      ],
      responses: [{ checklistItemId: item(v, 'sol_damaged_panel_count'), numericValue: 1 }],
    });
    expect(saved.modules.solar).toMatchObject({ panelsInstalled: 12, panelsOperational: 11, damagedPanelCount: 1 });
  });

  it('each battery is recorded where the battery count is configured, and required before completion', async () => {
    const v = await start(sites.batteries);
    expect(v.notApplicableSections).toEqual(['GENERATOR', 'SOLAR']);
    expect(v.issues.filter((i) => i.refType === 'battery_unit').map((i) => i.label)).toEqual(['Battery 1 voltage', 'Battery 2 voltage', 'Battery 3 voltage', 'Battery 4 voltage']);

    const bad = await tech.put(`/visits/${v.id}/battery-units`, { units: [{ unitNumber: 5, voltageV: 12.8 }] }).expect(422);
    expect(bad.body.error.details).toEqual([{ path: 'units.0.unitNumber', message: 'this site has 4 batteries' }]);
    await tech.put(`/visits/${v.id}/battery-units`, { units: [{ unitNumber: 1, voltageV: 1 }, { unitNumber: 1, voltageV: 2 }] }).expect(422);

    const saved = (
      await tech
        .put(`/visits/${v.id}/battery-units`, {
          units: [
            { unitNumber: 1, voltageV: 13.1, clientUpdatedAt: '2026-09-15T10:00:00Z' },
            { unitNumber: 2, voltageV: 12.9 },
            { unitNumber: 3, voltageV: 13.0 },
            { unitNumber: 4, voltageV: 11.2, comment: 'Weak cell' },
          ],
        })
        .expect(200)
    ).body.data as Visit;
    expect(saved.issues.some((i) => i.refType === 'battery_unit')).toBe(false);
    expect(saved.modules.battery).toMatchObject({ unitsRecorded: 4, minUnitVoltageV: 11.2, maxUnitVoltageV: 13.1 });
    expect(saved.modules.battery!.units.map((u) => [u.unitNumber, u.voltageV])).toEqual([
      [1, 13.1],
      [2, 12.9],
      [3, 13],
      [4, 11.2],
    ]);
    const stale = (await tech.put(`/visits/${v.id}/battery-units`, { units: [{ unitNumber: 1, voltageV: 9, clientUpdatedAt: '2026-09-15T09:00:00Z' }] }).expect(200)).body.data as Visit;
    expect(stale.skippedBatteryUnits).toEqual([1]);
    const cleared = (await tech.put(`/visits/${v.id}/battery-units`, { units: [{ unitNumber: 4, voltageV: null }] }).expect(200)).body.data as Visit;
    expect(cleared.issues.filter((i) => i.refType === 'battery_unit').map((i) => i.refId)).toEqual(['4']);

    const noBank = await start(sites.plain);
    expect((await tech.put(`/visits/${noBank.id}/battery-units`, { units: [{ unitNumber: 1, voltageV: 12 }] }).expect(422)).body.error.code).toBe('BATTERY_UNITS_NOT_CONFIGURED');
    await save(noBank, { notApplicableSections: ['SOLAR'] });
  });

  it('site power history: newest first, scoped, unknown modules are not found', async () => {
    for (const hours of [100, 200]) {
      const v = await start(sites.plain);
      await save(v, { readings: [{ readingFieldId: field(v, 'running_hours'), numericValue: hours }] });
      await prisma.pmVisit.update({ where: { id: v.id }, data: { status: 'COMPLETED' } });
    }
    const rows = (await supervisorA.get(`/sites/${sites.plain}/power/generator`).expect(200)).body.data as { runningHours: number; visit: { status: string } }[];
    expect(rows.map((r) => r.runningHours)).toEqual([200, 100]);
    expect(rows[0]!.visit.status).toBe('COMPLETED');
    expect((await supervisorA.get(`/sites/${sites.plain}/power/dc?limit=1`).expect(200)).body.data).toHaveLength(1);
    await supervisorB.get(`/sites/${sites.plain}/power/generator`).expect(404);
    await admin.get(`/sites/${sites.plain}/power/nuclear`).expect(404);
    await admin.get(`/sites/${sites.plain}/power/generator?limit=500`).expect(422);
  });

  it('the site battery count is set by administrators and validated', async () => {
    await admin.patch(`/sites/${sites.plain}`, { batteryUnitCount: 0 }).expect(422);
    const s = (await admin.patch(`/sites/${sites.plain}`, { batteryUnitCount: 24 }).expect(200)).body.data;
    expect(s.batteryUnitCount).toBe(24);
    await supervisorA.patch(`/sites/${sites.plain}`, { batteryUnitCount: 8 }).expect(403);
  });
});
