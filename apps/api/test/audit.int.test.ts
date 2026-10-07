import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ROUTES, routeKey } from '../src/audit/audit-actions.js';
import { AssignmentsService } from '../src/assignments/assignments.service.js';
import { OrganisationService } from '../src/organisation/organisation.service.js';
import { SchedulesService } from '../src/pm/schedules.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { UsersService } from '../src/users/users.service.js';
import { resetData } from './db.js';
import { makeOrg, makeUser } from './fixtures.js';
import { login, PASSWORD, setPassword, signIn, type Http } from './http.js';
import { completePm } from './pm-helpers.js';
import { startApp, testConfig } from './support.js';

let app: NestExpressApplication;
let http: Http;
let prisma: PrismaService;
type As = Awaited<ReturnType<typeof signIn>>;
let as: Record<'admin' | 'supervisorA' | 'tech1', As>;
let ids: Record<'regionA' | 'siteA1' | 'admin' | 'supervisorA' | 'tech1', string>;
let emails: Record<'admin' | 'tech1', string>;

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
  const siteA1 = await org.createSite({ siteCode: 'A-1', siteName: 'Alpha one', regionId: a.region.id, generatorAvailable: true }, null);
  const make = async (roles: string[], extra: Record<string, unknown> = {}) => {
    const u = await makeUser(users, roles, extra);
    await setPassword(prisma, u.id);
    return u;
  };
  const admin = await make(['SUPER_ADMIN'], { fullName: 'Ada Admin' });
  const supervisorA = await make(['REGIONAL_SUPERVISOR'], { regionScopeIds: [a.region.id] });
  const tech1 = await make(['TECHNICIAN'], { fullName: 'Tech One', homeRegionId: a.region.id });
  await app.get(AssignmentsService).assign({ siteId: siteA1.id, userId: tech1.id, role: 'TECHNICIAN', startDate: '2026-01-01' }, admin.id);
  ids = { regionA: a.region.id, siteA1: siteA1.id, admin: admin.id, supervisorA: supervisorA.id, tech1: tech1.id };
  emails = { admin: admin.email, tech1: tech1.email };
  as = { admin: await signIn(http, admin.email), supervisorA: await signIn(http, supervisorA.email), tech1: await signIn(http, tech1.email) };
  await prisma.$executeRawUnsafe('TRUNCATE TABLE `audit_logs`'); // start each test without the sign-ins above
});

const entries = (where: Record<string, unknown> = {}) => prisma.auditLog.findMany({ where, orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] });

describe('coverage', () => {
  it('every route that changes something is listed (audited or skipped with a reason)', () => {
    const router = (app.getHttpAdapter().getInstance() as { router: { stack: { route?: { path: string; methods: Record<string, boolean> } }[] } }).router;
    const routes = router.stack
      .filter((l) => l.route && !l.route.path.includes('*')) // the catch-all not-found handler
      .flatMap((l) => Object.keys(l.route!.methods).map((m) => routeKey(m, l.route!.path.replace(/^\/api\/v\d+/, ''))));
    const changing = routes.filter((k) => !k.startsWith('GET ') && !k.startsWith('HEAD ') && !k.startsWith('OPTIONS '));
    expect(changing.length).toBeGreaterThan(60);
    expect(changing.filter((k) => !ROUTES[k])).toEqual([]);
    // …and nothing listed that the app does not have.
    expect(Object.keys(ROUTES).filter((k) => !routes.includes(k))).toEqual([]);
  });
});

describe('what is recorded', () => {
  it('a change: who, what, which record, the fields that changed and what was sent', async () => {
    await as.admin.patch(`/sites/${ids.siteA1}`, { siteName: 'Alpha One (upgraded)', gridAvailable: true }).expect(200);
    const [e] = await entries();
    expect(e).toMatchObject({
      actorId: ids.admin,
      actorName: 'Ada Admin',
      action: 'site.update',
      outcome: 'SUCCESS',
      entityType: 'site',
      entityId: ids.siteA1,
      summary: 'Site changed',
      method: 'PATCH',
      path: `/api/v1/sites/${ids.siteA1}`,
      changes: { siteName: { from: 'Alpha one', to: 'Alpha One (upgraded)' }, gridAvailable: { from: false, to: true } },
      request: { params: { id: ids.siteA1 }, body: { siteName: 'Alpha One (upgraded)', gridAvailable: true } },
    });
    expect(e!.requestId).toBeTruthy();
    expect(e!.ip).toBeTruthy();
  });

  it('created records get their new id; roles and regions show as before/after lists', async () => {
    const created = (await as.admin.post('/users', { email: 'new.person@example.com', fullName: 'New Person', roles: ['TECHNICIAN'] }).expect(201)).body.data;
    // A viewer needs a region in scope, so the region comes first.
    await as.admin.put(`/users/${created.id}/region-scopes`, { regionIds: [ids.regionA] }).expect(200);
    await as.admin.put(`/users/${created.id}/roles`, { roles: ['TECHNICIAN', 'VIEWER'] }).expect(200);
    const [create, regions, roles] = await entries();
    expect(create).toMatchObject({ action: 'user.create', entityId: created.id });
    expect(roles).toMatchObject({ action: 'user.set_roles', changes: { roles: { from: ['TECHNICIAN'], to: ['TECHNICIAN', 'VIEWER'] } } });
    expect(regions).toMatchObject({ action: 'user.set_regions', changes: { regions: { from: [], to: ['Region A'] } } });
  });

  it('passwords and tokens are never written', async () => {
    await login(http, emails.tech1, 'wrong-password').expect(401);
    await as.admin.post(`/users/${ids.tech1}/temporary-password`, { temporaryPassword: 'Temporary-Pass-2026!' }).expect(204);
    await as.admin.post('/auth/change-password', { currentPassword: PASSWORD, newPassword: 'Another-Pass-2026!', client: 'web' }).expect(200);
    const all = JSON.stringify(await entries());
    for (const secret of ['wrong-password', 'Temporary-Pass-2026!', PASSWORD, 'Another-Pass-2026!', 'accessToken', 'refreshToken"']) expect(all).not.toContain(secret);
    const [failed, temp, changed] = await entries();
    expect(failed).toMatchObject({ action: 'auth.login_failed', outcome: 'FAILED', actorId: null, request: { body: { email: emails.tech1, password: '[not recorded]' } } });
    expect(failed!.summary).toContain(`Sign-in failed for ${emails.tech1}`);
    expect(temp).toMatchObject({ action: 'user.temporary_password', entityId: ids.tech1, request: { body: { temporaryPassword: '[not recorded]' } } });
    expect(temp!.changes).toMatchObject({ passwordHash: { from: '[not recorded]', to: '[changed]' } });
    expect(changed).toMatchObject({ action: 'auth.change_password', actorId: ids.admin, entityId: ids.admin });
  });

  it('sign-in: the user is known from the result', async () => {
    await login(http, emails.admin).expect(200);
    expect(await entries()).toEqual([expect.objectContaining({ action: 'auth.login', actorId: ids.admin, entityId: ids.admin, summary: 'Signed in' })]);
  });

  it('refused attempts, by permission or by scope, are recorded', async () => {
    await as.tech1.patch(`/sites/${ids.siteA1}`, { siteName: 'Hacked' }).expect(403);
    await as.tech1.get('/audit').expect(403);
    const [site, audit] = await entries();
    expect(site).toMatchObject({ action: 'site.update', outcome: 'DENIED', actorId: ids.tech1, entityId: ids.siteA1, changes: null });
    expect(site!.summary).toMatch(/^Refused: Site changed/);
    expect(audit).toMatchObject({ outcome: 'DENIED', actorId: ids.tech1, action: 'GET /audit' });
    // Nothing changed on the site.
    expect((await prisma.site.findUniqueOrThrow({ where: { id: ids.siteA1 } })).siteName).toBe('Alpha one');
  });

  it('a PM from start to approval, and the report and export handed out', async () => {
    const t = app.get(SchedulesService).today();
    const s = (await as.supervisorA.post('/pm-schedules', { siteId: ids.siteA1, technicianId: ids.tech1, scheduledDate: t, dueDate: t }).expect(201)).body.data[0];
    const visitId = await completePm(as.tech1, { scheduleId: s.id });
    await as.supervisorA.post(`/visits/${visitId}/review`, { decision: 'APPROVE', comments: 'Good' }).expect(200);
    await as.supervisorA.get(`/visits/${visitId}/report.pdf`).expect(200);
    await as.supervisorA.get('/exports/visits.csv?status=APPROVED').expect(200);
    const actions = (await entries()).map((e) => e.action);
    // Photos the checklist asks for are uploaded between saving the answers and signing.
    expect(actions.filter((x) => x !== 'visit.photo_add')).toEqual(['schedule.create', 'visit.start', 'visit.save_answers', 'visit.sign', 'visit.complete', 'visit.review', 'report.visit_pdf', 'export.csv']);
    expect((await entries({ action: 'visit.photo_add' }))[0]).toMatchObject({ entityId: visitId, request: { file: { name: expect.any(String), size: expect.any(Number) } } });
    const review = (await entries({ action: 'visit.review' }))[0]!;
    expect(review).toMatchObject({ summary: 'PM reviewed (approved)', entityId: visitId, changes: expect.objectContaining({ status: { from: 'COMPLETED', to: 'APPROVED' } }) });
    const exp = (await entries({ action: 'export.csv' }))[0]!;
    expect(exp).toMatchObject({ summary: 'CSV exported (visits.csv)', request: { query: { status: 'APPROVED' } } });
    // A long list of answers is summarised, not copied.
    const answers = (await entries({ action: 'visit.save_answers' }))[0]!;
    expect((answers.request as { body: { responses: unknown } }).body.responses).toMatch(/^\[\d+ items\]$/);
  });

  it('settings: the value before and after', async () => {
    await as.admin.put('/settings/geofence', { mode: 'BLOCK', radiusM: 250 }).expect(200);
    const [e] = await entries();
    expect(e).toMatchObject({ action: 'settings.update', entityType: 'setting', entityId: 'geofence', summary: 'Setting changed (geofence)' });
    expect((e!.changes as { value: { to: unknown } }).value.to).toEqual({ mode: 'BLOCK', radiusM: 250 });
  });

  it('failed validation changes nothing and is not recorded', async () => {
    await as.admin.patch(`/sites/${ids.siteA1}`, { siteName: '' }).expect(422);
    expect(await entries()).toEqual([]);
  });
});

describe('the log itself', () => {
  it('cannot be changed or deleted, even by the API’s own database user', async () => {
    await as.admin.patch(`/sites/${ids.siteA1}`, { siteName: 'X' }).expect(200);
    await expect(prisma.$executeRawUnsafe("UPDATE audit_logs SET summary = 'edited'")).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe('DELETE FROM audit_logs')).rejects.toThrow(/append-only/);
    expect(await prisma.auditLog.count()).toBe(1);
  });

  it('is read by Super Admins only: list with filters, one entry, CSV', async () => {
    await as.admin.patch(`/sites/${ids.siteA1}`, { siteName: 'Alpha two' }).expect(200);
    await as.tech1.patch(`/sites/${ids.siteA1}`, { siteName: 'Nope' }).expect(403);
    const list = await as.admin.get('/audit').expect(200);
    expect(list.body.meta.total).toBe(2);
    expect(list.body.data[0]).not.toHaveProperty('request');
    expect((await as.admin.get('/audit?outcome=DENIED').expect(200)).body.data.map((e: { actorId: string }) => e.actorId)).toEqual([ids.tech1]);
    expect((await as.admin.get(`/audit?entityType=site&entityId=${ids.siteA1}`).expect(200)).body.meta.total).toBe(2);
    expect((await as.admin.get('/audit?q=Ada').expect(200)).body.meta.total).toBe(1);
    const one = await as.admin.get(`/audit/${list.body.data[1].id}`).expect(200);
    expect(one.body.data.changes).toEqual({ siteName: { from: 'Alpha one', to: 'Alpha two' } });
    expect((await as.admin.get('/audit/actions').expect(200)).body.data).toMatchObject({ 'site.update': 'Site changed', 'auth.login_failed': 'Sign-in failed' });
    const csv = await as.admin.get('/audit/export.csv').expect(200);
    expect(csv.headers['content-type']).toBe('text/csv; charset=utf-8');
    // Header, the change, the refusal and the export itself (recorded before the rows are read).
    const rows = csv.text.replace(/^\uFEFF/, '').trimEnd().split('\r\n');
    expect(rows).toHaveLength(4);
    expect(rows[3]).toContain('audit.export');
  });
});
