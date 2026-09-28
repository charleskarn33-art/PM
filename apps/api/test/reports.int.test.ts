import type { NestExpressApplication } from '@nestjs/platform-express';
import sharp from 'sharp';
import type { Response } from 'supertest';
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
let ids: Record<'regionA' | 'siteA1' | 'siteA2' | 'siteB' | 'tech1', string>;

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
  const siteA2 = await org.createSite({ siteCode: 'A-2', siteName: 'Alpha two', regionId: a.region.id }, null);
  const siteB = await org.createSite({ siteCode: 'B-1', siteName: 'Bravo', regionId: b.region.id }, null);
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
  await assignments.assign({ siteId: siteA1.id, userId: tech1.id, role: 'TECHNICIAN', startDate: '2026-01-01' }, admin.id);
  await assignments.assign({ siteId: siteA2.id, userId: tech1.id, role: 'TECHNICIAN', startDate: '2026-01-01' }, admin.id);
  ids = { regionA: a.region.id, siteA1: siteA1.id, siteA2: siteA2.id, siteB: siteB.id, tech1: tech1.id };
  as = {
    admin: await signIn(http, admin.email),
    supervisorA: await signIn(http, supervisorA.email),
    supervisorB: await signIn(http, supervisorB.email),
    tech1: await signIn(http, tech1.email),
    viewerA: await signIn(http, viewerA.email),
  };
});

const binary = (res: Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};
const pdfOf = (who: As, path: string) => who.get(path).buffer(true).parse(binary as never);
/** CSV text without the byte-order mark, as rows of raw lines. */
const lines = (text: string) => text.replace(/^\uFEFF/, '').trimEnd().split('\r\n');

describe('PM visit report (PDF)', () => {
  it('is built from the stored visit, within scope', async () => {
    const t = app.get(SchedulesService).today();
    const schedule = (await as.supervisorA.post('/pm-schedules', { siteId: ids.siteA1, technicianId: ids.tech1, scheduledDate: t, dueDate: t }).expect(201)).body.data[0];
    const visitId = await completePm(as.tech1, { scheduleId: schedule.id, failing: ['gen_automation_working'] });
    const res = await pdfOf(as.supervisorA, `/visits/${visitId}/report.pdf`).expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toMatch(/^inline; filename="PM-A-1-\d{4}-\d{2}-\d{2}\.pdf"$/);
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    // The technician who did it may read it too; other regions may not.
    await pdfOf(as.tech1, `/visits/${visitId}/report.pdf`).expect(200);
    await as.supervisorB.get(`/visits/${visitId}/report.pdf`).expect(404);
    await as.admin.get(`/visits/01999999-9999-7999-8999-999999999999/report.pdf`).expect(404);
  });

  it('prints WebP photos (converted) and leaves out a photo that cannot be read', async () => {
    const visit = (await as.tech1.post('/visits', { siteId: ids.siteA2 }).expect(201)).body.data;
    const webp = await sharp({ create: { width: 320, height: 240, channels: 3, background: '#2a78d6' } }).webp().toBuffer();
    await as.tech1.upload(`/visits/${visit.id}/photos`, webp, 'site.webp', { caption: 'Site gate' }).expect(201);
    const broken = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
    await as.tech1.upload(`/visits/${visit.id}/photos`, broken, 'broken.jpg').expect(201);
    const pdf = (await pdfOf(as.tech1, `/visits/${visit.id}/report.pdf`).expect(200)).body as Buffer;
    const images = pdf.toString('latin1').match(/\/Subtype \/Image/g) ?? [];
    expect(images).toHaveLength(1);
  });
});

describe('CSV exports', () => {
  async function scenario() {
    const t = app.get(SchedulesService).today();
    const schedule = (await as.supervisorA.post('/pm-schedules', { siteId: ids.siteA1, technicianId: ids.tech1, scheduledDate: t, dueDate: t }).expect(201)).body.data[0];
    const visitId = await completePm(as.tech1, { scheduleId: schedule.id, failing: ['gen_automation_working'] });
    await as.supervisorB.post('/pm-schedules', { siteId: ids.siteB, scheduledDate: t, dueDate: t }).expect(201);
    return { visitId };
  }

  it('exports visits with key readings, within scope, spreadsheet-safe', async () => {
    const { visitId } = await scenario();
    const res = await as.supervisorA.get('/exports/visits.csv').expect(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="visits-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(res.text.startsWith('\uFEFF')).toBe(true);
    const rows = lines(res.text);
    expect(rows[0]).toContain('Visit ID,Site code,Site name,Region,Technician');
    expect(rows[0]).toContain('DC power (kW)');
    expect(rows).toHaveLength(2);
    expect(rows[1]).toContain(visitId);
    expect(rows[1]).toContain(',A-1,Alpha one,Region A,Tech One,');
    expect(rows[1]).toContain(',COMPLETED,');
    expect(lines((await as.supervisorB.get('/exports/visits.csv').expect(200)).text)).toHaveLength(1);
    expect(lines((await as.supervisorA.get(`/exports/visits.csv?status=APPROVED`).expect(200)).text)).toHaveLength(1);
    expect(lines((await as.supervisorA.get(`/exports/visits.csv?siteId=${ids.siteA1}`).expect(200)).text)).toHaveLength(2);
  });

  it('exports schedules, failures, corrective actions, sites and readings', async () => {
    await scenario();
    const csv = async (path: string) => lines((await as.admin.get(path).expect(200)).text);
    expect(await csv('/exports/schedules.csv')).toHaveLength(3);
    const failures = await csv('/exports/failures.csv?status=active');
    expect(failures).toHaveLength(2);
    expect(failures[1]).toMatch(/^FL-000001,A-1,/);
    expect(await csv('/exports/failures.csv?severity=CRITICAL')).toHaveLength(1);
    const [failure] = (await as.admin.get('/failures').expect(200)).body.data;
    // A comment that looks like a formula is exported as text.
    await as.supervisorA.post('/corrective-actions', { failureId: failure.id, title: '=cmd|calc', assignedToId: ids.tech1 }).expect(201);
    const actions = await csv('/exports/corrective-actions.csv');
    expect(actions[1]).toMatch(/^CA-000001,FL-000001,A-1,Alpha one,Region A,'=cmd\|calc,MEDIUM,ASSIGNED,Tech One,/);
    expect(await csv('/exports/failures.csv?source=MANUAL')).toHaveLength(1);
    expect(await csv('/exports/failures.csv?source=PM_CHECKLIST')).toHaveLength(2);
    expect(lines((await as.tech1.get('/exports/corrective-actions.csv?assignedTo=me').expect(403)).text)).toHaveLength(1);
    expect(lines((await as.supervisorA.get('/exports/corrective-actions.csv?assignedTo=me').expect(200)).text)).toHaveLength(1);
    expect(await csv('/exports/corrective-actions.csv?overdue=true')).toHaveLength(1);
    // Sites follow the site list's own filters (here: sites with an open PM — A-1's was completed — and a text search).
    expect((await csv('/exports/sites.csv?pm=scheduled')).slice(1).map((l) => l.split(',')[0])).toEqual(['B-1']);
    expect(await csv('/exports/sites.csv?q=Bravo')).toHaveLength(2);
    const sites = await csv(`/exports/sites.csv?regionId=${ids.regionA}`);
    expect(sites.slice(1).map((l) => l.split(',')[0])).toEqual(['A-1', 'A-2']);
    expect(sites[1]).toContain('Tech One');
    for (const module of ['dc', 'battery', 'generator']) expect(await csv(`/exports/readings.csv?module=${module}`)).toHaveLength(2);
  });

  it('needs reports.export and valid filters', async () => {
    await as.tech1.get('/exports/visits.csv').expect(403);
    await as.viewerA.get('/exports/visits.csv').expect(200);
    await as.admin.get('/exports/users.csv').expect(404);
    await as.admin.get('/exports/visits.csv?status=DONE').expect(422);
    await as.admin.get('/exports/visits.csv?from=28-09-2026').expect(422);
    await as.admin.get('/exports/readings.csv').expect(422);
  });
});

describe('site PM history', () => {
  it('lists the site’s visits, newest first, with results and key readings', async () => {
    const t = app.get(SchedulesService).today();
    const schedule = (await as.supervisorA.post('/pm-schedules', { siteId: ids.siteA1, technicianId: ids.tech1, scheduledDate: t, dueDate: t }).expect(201)).body.data[0];
    const first = await completePm(as.tech1, { scheduleId: schedule.id });
    await as.supervisorA.post(`/visits/${first}/review`, { decision: 'APPROVE' }).expect(200);
    const second = (await as.tech1.post('/visits', { siteId: ids.siteA1 }).expect(201)).body.data.id;
    const res = await as.supervisorA.get(`/sites/${ids.siteA1}/pm-history`).expect(200);
    expect(res.body.meta).toMatchObject({ total: 2, page: 1, site: { siteCode: 'A-1' }, summary: { APPROVED: 1, IN_PROGRESS: 1 } });
    expect(res.body.data.map((v: { id: string }) => v.id)).toEqual([second, first]);
    expect(res.body.data[1]).toMatchObject({ status: 'APPROVED', onTime: true, dueDate: t, failureCount: 0, technician: { fullName: 'Tech One' }, readings: { dcPowerKw: expect.any(Number) } });
    expect(res.body.data[0]).toMatchObject({ status: 'IN_PROGRESS', onTime: null });
    // The visit list's `finished` filter (used by the Reports page): completed or approved only.
    expect((await as.supervisorA.get(`/visits?siteId=${ids.siteA1}&status=finished`).expect(200)).body.data.map((v: { id: string }) => v.id)).toEqual([first]);
    await as.supervisorB.get(`/sites/${ids.siteA1}/pm-history`).expect(404);
    await as.tech1.get(`/sites/${ids.siteA1}/pm-history?pageSize=1`).expect(200);
  });
});
