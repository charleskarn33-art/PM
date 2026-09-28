import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AssignmentsService } from '../src/assignments/assignments.service.js';
import { NotificationJobs } from '../src/notifications/notification.jobs.js';
import { PushSender } from '../src/notifications/push.sender.js';
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
let as: Record<'admin' | 'supervisorA' | 'supervisorB' | 'managerA' | 'tech1' | 'tech2', As>;
let ids: Record<'regionA' | 'siteA1' | 'siteA2' | 'siteB' | 'admin' | 'supervisorA' | 'supervisorB' | 'managerA' | 'tech1' | 'tech2' | 'tech3', string>;

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
  const supervisorA = await make(['REGIONAL_SUPERVISOR'], { regionScopeIds: [a.region.id], fullName: 'Supervisor Alpha' });
  const supervisorB = await make(['REGIONAL_SUPERVISOR'], { regionScopeIds: [b.region.id] });
  const managerA = await make(['REGIONAL_MANAGER'], { regionScopeIds: [a.region.id] });
  const tech1 = await make(['TECHNICIAN'], { fullName: 'Tech One', homeRegionId: a.region.id });
  const tech2 = await make(['TECHNICIAN'], { fullName: 'Tech Two', homeRegionId: b.region.id });
  const tech3 = await make(['TECHNICIAN'], { fullName: 'Tech Three', homeRegionId: a.region.id });
  // Set up without notifications (the service built by the fixtures has none); later assignments go through the API.
  await assignments.assign({ siteId: siteA1.id, userId: tech1.id, role: 'TECHNICIAN', startDate: '2026-01-01' }, admin.id);
  await assignments.assign({ siteId: siteB.id, userId: tech2.id, role: 'TECHNICIAN', startDate: '2026-01-01' }, admin.id);
  await prisma.notification.deleteMany();
  ids = {
    regionA: a.region.id, siteA1: siteA1.id, siteA2: siteA2.id, siteB: siteB.id, admin: admin.id, supervisorA: supervisorA.id,
    supervisorB: supervisorB.id, managerA: managerA.id, tech1: tech1.id, tech2: tech2.id, tech3: tech3.id,
  };
  as = {
    admin: await signIn(http, admin.email),
    supervisorA: await signIn(http, supervisorA.email),
    supervisorB: await signIn(http, supervisorB.email),
    managerA: await signIn(http, managerA.email),
    tech1: await signIn(http, tech1.email),
    tech2: await signIn(http, tech2.email),
  };
});

const today = () => app.get(SchedulesService).today();
const shift = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** Every notification, as `user:type`, in creation order. */
async function sent(): Promise<string[]> {
  const rows = await prisma.notification.findMany({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { userId: true, type: true } });
  const name = Object.fromEntries(Object.entries(ids).map(([k, v]) => [v, k]));
  return rows.map((r) => `${name[r.userId]}:${r.type}`);
}
const types = async (who: As) => (await who.get('/notifications').expect(200)).body.data.map((n: { type: string }) => n.type);

describe('PM notifications', () => {
  it('scheduled → submitted → returned → submitted → approved, never to the person who acted', async () => {
    const t = today();
    const schedule = (await as.supervisorA.post('/pm-schedules', { siteId: ids.siteA1, technicianId: ids.tech1, scheduledDate: t, dueDate: t }).expect(201)).body.data[0];
    expect(await sent()).toEqual(['tech1:PM_SCHEDULED']);
    const visitId = await completePm(as.tech1, { scheduleId: schedule.id });
    // The region's supervisor is told (not the admin, not region B's supervisor, not the technician).
    expect(await sent()).toEqual(['tech1:PM_SCHEDULED', 'supervisorA:PM_SUBMITTED']);
    await as.supervisorA.post(`/visits/${visitId}/review`, { decision: 'REJECT', comments: 'Photo of the panel is blurred' }).expect(200);
    const [returned] = (await as.tech1.get('/notifications').expect(200)).body.data;
    expect(returned).toMatchObject({ type: 'PM_RETURNED', entityType: 'visit', entityId: visitId, readAt: null });
    expect(returned.body).toContain('Photo of the panel is blurred');
    await completePm(as.tech1, { visitId });
    await as.supervisorA.post(`/visits/${visitId}/review`, { decision: 'APPROVE' }).expect(200);
    expect(await sent()).toEqual(['tech1:PM_SCHEDULED', 'supervisorA:PM_SUBMITTED', 'tech1:PM_RETURNED', 'supervisorA:PM_SUBMITTED', 'tech1:PM_APPROVED']);
  });

  it('a recurring series is one notification; a reassigned PM tells the new technician', async () => {
    await as.admin.post('/assignments', { siteId: ids.siteA1, userId: ids.tech3, role: 'TECHNICIAN', startDate: today() }).expect(201);
    const rows = (await as.supervisorA.post('/pm-schedules', { siteId: ids.siteA1, technicianId: ids.tech1, scheduledDate: today(), dueDate: shift(today(), 5), occurrences: 6 }).expect(201)).body.data;
    expect(rows).toHaveLength(6);
    const [n] = (await as.tech1.get('/notifications').expect(200)).body.data;
    expect(n.title).toBe('6 PMs scheduled at A-1');
    await as.supervisorA.patch(`/pm-schedules/${rows[1].id}`, { technicianId: ids.tech3 }).expect(200);
    expect(await sent()).toEqual(['tech3:SITE_ASSIGNED', 'tech1:PM_SCHEDULED', 'tech3:PM_SCHEDULED']);
  });

  it('overdue PMs notify the technician and the site’s supervisors once', async () => {
    await as.admin.post('/assignments', { siteId: ids.siteA1, userId: ids.supervisorA, role: 'SUPERVISOR', startDate: today() }).expect(201);
    await prisma.notification.deleteMany();
    const s = (await as.supervisorA.post('/pm-schedules', { siteId: ids.siteA1, technicianId: ids.tech1, scheduledDate: today(), dueDate: today() }).expect(201)).body.data[0];
    const schedules = app.get(SchedulesService);
    expect(await schedules.markOverdue(shift(today(), 1))).toBe(1);
    expect(await schedules.markOverdue(shift(today(), 2))).toBe(0);
    // Assigned supervisor and regional supervisor are the same person here: told once.
    expect((await sent()).sort()).toEqual(['supervisorA:PM_OVERDUE', 'tech1:PM_OVERDUE', 'tech1:PM_SCHEDULED']);
    expect((await as.supervisorA.get('/notifications').expect(200)).body.data[0]).toMatchObject({ type: 'PM_OVERDUE', entityType: 'schedule', entityId: s.id });
  });
});

describe('failure and corrective-action notifications', () => {
  it('critical failures reach the region’s supervisors and managers', async () => {
    await as.tech1.post('/failures', { siteId: ids.siteA1, title: 'Rectifier on fire', severity: 'CRITICAL' }).expect(201);
    await as.tech1.post('/failures', { siteId: ids.siteA1, title: 'Loose cable', severity: 'LOW' }).expect(201);
    expect((await sent()).sort()).toEqual(['managerA:FAILURE_CRITICAL', 'supervisorA:FAILURE_CRITICAL']);
    // Raised to critical later: told then (once).
    const low = (await as.supervisorA.get('/failures?q=Loose').expect(200)).body.data[0];
    await as.supervisorA.patch(`/failures/${low.id}`, { severity: 'CRITICAL' }).expect(200);
    await as.supervisorA.patch(`/failures/${low.id}`, { severity: 'HIGH' }).expect(200);
    await as.supervisorA.patch(`/failures/${low.id}`, { severity: 'CRITICAL' }).expect(200);
    expect((await sent()).filter((x) => x === 'managerA:FAILURE_CRITICAL')).toHaveLength(2);
    expect((await sent()).filter((x) => x.startsWith('supervisorA'))).toHaveLength(1); // they raised it
  });

  it('assigned, completed (to verify) and sent back', async () => {
    const failure = (await as.tech1.post('/failures', { siteId: ids.siteA1, title: 'ATS fault' }).expect(201)).body.data;
    const action = (await as.supervisorA.post('/corrective-actions', { failureId: failure.id, title: 'Replace ATS', assignedToId: ids.tech1, dueDate: shift(today(), 3) }).expect(201)).body.data;
    const [assigned] = (await as.tech1.get('/notifications').expect(200)).body.data;
    expect(assigned).toMatchObject({ type: 'ACTION_ASSIGNED', title: 'CA-000001 assigned to you', entityType: 'action', entityId: action.id });
    await as.tech1.post(`/corrective-actions/${action.id}/start`).expect(200);
    await as.tech1.post(`/corrective-actions/${action.id}/complete`, { note: 'ATS replaced' }).expect(200);
    await as.supervisorA.post(`/corrective-actions/${action.id}/verify`, { decision: 'REJECT', note: 'Still alarming' }).expect(200);
    expect(await sent()).toEqual(['tech1:ACTION_ASSIGNED', 'supervisorA:ACTION_COMPLETED', 'tech1:ACTION_RETURNED']);
  });
});

describe('scheduled reminders', () => {
  it('are off until configured, then sent once each', async () => {
    const jobs = app.get(NotificationJobs);
    await as.supervisorA.post('/pm-schedules', { siteId: ids.siteA1, technicianId: ids.tech1, scheduledDate: today(), dueDate: shift(today(), 2) }).expect(201);
    const failure = (await as.tech1.post('/failures', { siteId: ids.siteA1, title: 'Door lock' }).expect(201)).body.data;
    await as.supervisorA.post('/corrective-actions', { failureId: failure.id, title: 'Fix lock', assignedToId: ids.tech1, dueDate: today() }).expect(201);
    await prisma.notification.deleteMany();
    expect(await jobs.reminders(shift(today(), 1))).toBe(0);

    await as.admin.put('/settings/notifications', { pmDueReminderDays: 3, actionOverdueAlerts: true }).expect(200);
    await as.admin.put('/settings/notifications', { pmDueReminderDays: 0, actionOverdueAlerts: true }).expect(422);
    expect(await jobs.reminders(shift(today(), 1))).toBe(3);
    expect(await jobs.reminders(shift(today(), 1))).toBe(0);
    expect((await sent()).sort()).toEqual(['supervisorA:ACTION_OVERDUE', 'tech1:ACTION_OVERDUE', 'tech1:PM_DUE_SOON']);
  });
});

describe('the user’s notifications', () => {
  it('list, unread count, mark read and all read; only their own', async () => {
    await as.supervisorA.post('/pm-schedules', { siteId: ids.siteA1, technicianId: ids.tech1, scheduledDate: today(), dueDate: today(), occurrences: 1 }).expect(201);
    await as.tech1.post('/failures', { siteId: ids.siteA1, title: 'Fire', severity: 'CRITICAL' }).expect(201);
    await as.supervisorA.post('/pm-schedules', { siteId: ids.siteA1, technicianId: ids.tech1, scheduledDate: shift(today(), 1), dueDate: shift(today(), 1) }).expect(201);
    const list = await as.tech1.get('/notifications').expect(200);
    expect(list.body.meta).toMatchObject({ total: 2, unread: 2 });
    expect((await as.tech1.get('/notifications/unread-count').expect(200)).body.data).toEqual({ unread: 2 });
    const first = list.body.data[0].id;
    await as.supervisorA.post(`/notifications/${first}/read`).expect(404);
    expect((await as.tech1.post(`/notifications/${first}/read`).expect(200)).body.data).toEqual({ unread: 1 });
    expect((await as.tech1.get('/notifications?unread=true').expect(200)).body.data).toHaveLength(1);
    expect((await as.tech1.post('/notifications/read-all').expect(200)).body.data).toEqual({ marked: 1, unread: 0 });
    expect(await types(as.supervisorA)).toEqual(['FAILURE_CRITICAL']);
  });

  it('inactive users are not notified', async () => {
    await as.admin.post(`/users/${ids.supervisorA}/deactivate`, {}).expect(200);
    await as.tech1.post('/failures', { siteId: ids.siteA1, title: 'Fire', severity: 'CRITICAL' }).expect(201);
    expect(await sent()).toEqual(['managerA:FAILURE_CRITICAL']);
  });

  it('push tokens: registered per phone, moved to the new user, removed on sign-out', async () => {
    const token = 'ExponentPushToken[abcdefghijklmnop]';
    expect((await as.tech1.post('/push-tokens', { token, platform: 'android', deviceName: 'Field phone' }).expect(200)).body.data).toEqual({ registered: true, pushEnabled: false });
    await as.tech1.post('/push-tokens', { token: 'not-a-token', platform: 'android' }).expect(422);
    await as.tech2.post('/push-tokens', { token, platform: 'android' }).expect(200);
    expect(await prisma.pushToken.findMany({ select: { userId: true } })).toEqual([{ userId: ids.tech2 }]);
    expect((await as.tech1.del('/push-tokens').send({ token }).expect(200)).body.data).toEqual({ removed: 0 });
    expect((await as.tech2.del('/push-tokens').send({ token }).expect(200)).body.data).toEqual({ removed: 1 });
  });

  it('are not queued for push while push is disabled', async () => {
    await as.tech1.post('/failures', { siteId: ids.siteA1, title: 'Fire', severity: 'CRITICAL' }).expect(201);
    expect(await prisma.notification.findMany({ select: { pushStatus: true } })).toEqual([{ pushStatus: null }, { pushStatus: null }]);
    expect(await app.get(PushSender).runOnce()).toBe(0);
  });
});

describe('push sender (Expo push service, faked)', () => {
  let pushApp: NestExpressApplication;
  let fake: Server;
  let received: { to: string; title: string; data: { entityType: string } }[][] = [];
  let respond: (messages: { to: string }[]) => { status: number; body: unknown } = () => ({ status: 200, body: {} });

  beforeAll(async () => {
    fake = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const messages = JSON.parse(raw);
        received.push(messages);
        const r = respond(messages);
        res.writeHead(r.status, { 'Content-Type': 'application/json' }).end(JSON.stringify(r.body));
      });
    });
    await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(fake.address() as AddressInfo).port}/push`;
    pushApp = await startApp(testConfig({ PUSH_ENABLED: 'true', EXPO_PUSH_URL: url, AUTH_RATE_LIMIT_PER_MINUTE: '1000', RATE_LIMIT_PER_MINUTE: '100000' }), false);
  });
  afterAll(async () => {
    await pushApp?.close();
    await new Promise((r) => fake?.close(r));
  });

  it('sends to every phone, drops unregistered phones, retries when the service fails', async () => {
    received = [];
    const phone = 'ExponentPushToken[phone-one-aaaaaa]';
    const gone = 'ExponentPushToken[phone-gone-bbbbb]';
    await prisma.pushToken.createMany({ data: [{ userId: ids.supervisorA, token: phone, platform: 'android' }, { userId: ids.supervisorA, token: gone, platform: 'android' }] });
    const pushHttp = pushApp.getHttpServer();
    const tech = await signIn(pushHttp, (await prisma.user.findUniqueOrThrow({ where: { id: ids.tech1 } })).email);
    await tech.post('/failures', { siteId: ids.siteA1, title: 'Fire', severity: 'CRITICAL' }).expect(201);
    expect((await prisma.notification.findMany({ select: { pushStatus: true } })).map((n) => n.pushStatus)).toEqual(['PENDING', 'PENDING']);

    // First the service is down: nothing lost, tried again later.
    respond = () => ({ status: 503, body: {} });
    const sender = pushApp.get(PushSender);
    expect(await sender.runOnce()).toBe(2);
    const afterFailure = await prisma.notification.findMany({ select: { userId: true, pushStatus: true, pushAttempts: true } });
    expect(afterFailure.find((n) => n.userId === ids.supervisorA)).toMatchObject({ pushStatus: 'PENDING', pushAttempts: 1 });
    expect(afterFailure.find((n) => n.userId === ids.managerA)).toMatchObject({ pushStatus: 'NO_DEVICE' });

    // Then it answers: one phone accepted, the other no longer registered.
    received = [];
    respond = (messages) => ({ status: 200, body: { data: messages.map((m) => (m.to === gone ? { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } } : { status: 'ok', id: 'ticket-1' })) } });
    expect(await sender.runOnce()).toBe(1);
    expect(received).toHaveLength(1);
    expect(received[0]!.map((m) => m.to).sort()).toEqual([gone, phone].sort());
    expect(received[0]![0]).toMatchObject({ title: 'Critical failure at A-1', data: { entityType: 'failure' } });
    expect(await prisma.notification.findFirst({ where: { userId: ids.supervisorA } })).toMatchObject({ pushStatus: 'SENT', pushAttempts: 2 });
    expect((await prisma.pushToken.findMany()).map((t) => t.token)).toEqual([phone]);
    expect(await sender.runOnce()).toBe(0);
  });
});
