import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AssignmentsService } from '../src/assignments/assignments.service.js';
import { OrganisationService } from '../src/organisation/organisation.service.js';
import { SchedulesService } from '../src/pm/schedules.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { DEMO, removeDemoData, seedDemoData } from '../src/seed/demo.js';
import { UsersService } from '../src/users/users.service.js';
import { resetData } from './db.js';
import { makeOrg, makeUser } from './fixtures.js';
import { setPassword, signIn, type Http } from './http.js';
import { startApp, testConfig } from './support.js';

let app: NestExpressApplication;
let http: Http;
let prisma: PrismaService;
type As = Awaited<ReturnType<typeof signIn>>;
let as: Record<'admin' | 'supervisorA' | 'supervisorB' | 'tech1' | 'tech2' | 'techB', As>;
let ids: Record<'regionA' | 'siteA' | 'siteB' | 'tech1' | 'tech2' | 'techB', string>;

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);

beforeAll(async () => {
  app = await startApp(testConfig({ AUTH_RATE_LIMIT_PER_MINUTE: '1000', RATE_LIMIT_PER_MINUTE: '100000', PHOTO_MAX_BYTES: '200000' }), false);
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
  const siteA = await org.createSite({ siteCode: 'A-1', siteName: 'Site A', regionId: a.region.id, generatorAvailable: true, solarAvailable: false }, null);
  const siteB = await org.createSite({ siteCode: 'B-1', siteName: 'Site B', regionId: b.region.id, generatorAvailable: true, solarAvailable: true }, null);
  const make = async (roles: string[], extra: Record<string, unknown> = {}) => {
    const u = await makeUser(users, roles, extra);
    await setPassword(prisma, u.id);
    return u;
  };
  const admin = await make(['SUPER_ADMIN']);
  const supervisorA = await make(['REGIONAL_SUPERVISOR'], { regionScopeIds: [a.region.id] });
  const supervisorB = await make(['REGIONAL_SUPERVISOR'], { regionScopeIds: [b.region.id] });
  const tech1 = await make(['TECHNICIAN']);
  const tech2 = await make(['TECHNICIAN']);
  const techB = await make(['TECHNICIAN']);
  for (const [site, tech] of [
    [siteA, tech1],
    [siteA, tech2],
    [siteB, techB],
  ] as const) {
    await assignments.assign({ siteId: site.id, userId: tech.id, role: 'TECHNICIAN', startDate: '2026-09-01' }, admin.id);
  }
  ids = { regionA: a.region.id, siteA: siteA.id, siteB: siteB.id, tech1: tech1.id, tech2: tech2.id, techB: techB.id };
  as = {
    admin: await signIn(http, admin.email),
    supervisorA: await signIn(http, supervisorA.email),
    supervisorB: await signIn(http, supervisorB.email),
    tech1: await signIn(http, tech1.email),
    tech2: await signIn(http, tech2.email),
    techB: await signIn(http, techB.email),
  };
});

const today = () => app.get(SchedulesService).today();
const addDaysIso = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function schedule(who: As = as.supervisorA, over: Record<string, unknown> = {}) {
  const res = await who.post('/pm-schedules', { siteId: ids.siteA, technicianId: ids.tech1, scheduledDate: today(), dueDate: addDaysIso(today(), 7), ...over });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data[0] as { id: string; status: string; templateId: string };
}

interface VisitDetail {
  id: string;
  status: string;
  completionPct: number;
  failureCount: number;
  notApplicableSections: string[];
  sections: {
    code: string;
    items: { id: string; code: string; responseType: string; isRequired: boolean; failureOnAnswer: string | null; photoOnAnswers: string[]; commentOnAnswers: string[]; minValue: number | null }[];
    readingFields: { id: string; code: string; valueType: string; isRequired: boolean; minValue: number | null }[];
  }[];
  issues: { kind: string; refId: string; label: string }[];
  responses: { checklistItemId: string; answer: string | null; numericValue: number | null; isFailure: boolean }[];
  readings: { readingFieldId: string; numericValue: number | null; textValue: string | null }[];
}

async function startVisit(who = as.tech1, scheduleId?: string) {
  const res = await who.post('/visits', scheduleId ? { scheduleId } : { siteId: ids.siteA });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as VisitDetail;
}

/** Answers every required question with its non-failure answer and fills every reading; adds photos where an answer needs one. */
async function fillAll(who: As, visit: VisitDetail) {
  const responses: Record<string, unknown>[] = [];
  const readings: Record<string, unknown>[] = [];
  const photosFor: string[] = [];
  for (const s of visit.sections) {
    if (visit.notApplicableSections.includes(s.code)) continue;
    for (const i of s.items) {
      if (i.responseType === 'YES_NO_NA') {
        const answer = i.failureOnAnswer === 'YES' ? 'NO' : 'YES';
        responses.push({ checklistItemId: i.id, answer, ...(i.commentOnAnswers.includes(answer) ? { comment: 'Noted on site' } : {}) });
        if (i.photoOnAnswers.includes(answer)) photosFor.push(i.id);
      } else if (i.responseType === 'NUMBER' && i.isRequired) {
        responses.push({ checklistItemId: i.id, numericValue: i.minValue ?? 0 });
      }
    }
    for (const f of s.readingFields) readings.push(f.valueType === 'NUMBER' ? { readingFieldId: f.id, numericValue: 3 } : { readingFieldId: f.id, textValue: 'Okay' });
  }
  const res = await who.put(`/visits/${visit.id}/answers`, { responses, readings });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  for (const itemId of photosFor) await uploadPhoto(who, visit.id, { checklistItemId: itemId }).expect(201);
  return res.body.data as VisitDetail;
}

function uploadPhoto(who: As, visitId: string, fields: Record<string, string> = {}, file: Buffer = JPEG, name = 'photo.jpg') {
  let r = request(http).post(`/api/v1/visits/${visitId}/photos`).set('Authorization', `Bearer ${who.session.accessToken}`);
  for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
  return r.attach('file', file, { filename: name, contentType: 'image/jpeg' });
}

const item = (v: VisitDetail, code: string) => v.sections.flatMap((s) => s.items).find((i) => i.code === code)!;
const field = (v: VisitDetail, code: string) => v.sections.flatMap((s) => s.readingFields).find((f) => f.code === code)!;

describe('templates', () => {
  it('the reference template is seeded: version 1 active, six sections of the Tienii report', async () => {
    const list = (await as.tech1.get('/pm-templates').expect(200)).body.data;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ code: 'TELECOM_SITE_POWER_PM', version: 1, status: 'ACTIVE', sectionCount: 6 });
    const t = (await as.tech1.get(`/pm-templates/${list[0].id}`).expect(200)).body.data;
    expect(t.sections.map((s: { code: string }) => s.code)).toEqual(['GENERATOR', 'DC_SYSTEM', 'BATTERY', 'SOLAR', 'NON_TECHNICAL', 'EARTHING']);
    expect(t.sections.flatMap((s: { items: unknown[] }) => s.items)).toHaveLength(69);
    expect(t.sections.flatMap((s: { readingFields: unknown[] }) => s.readingFields)).toHaveLength(16);
    const gen = t.sections[0];
    expect(gen.readingFields.map((f: { label: string }) => f.label)).toEqual(['Running Hours', 'Oil Pressure', 'Fuel Level (%)', 'Generator KVA']);
    expect(gen.items.find((i: { code: string }) => i.code === 'gen_burning_oil')).toMatchObject({ failureOnAnswer: 'YES', requiresPhotoOnFailure: true, failureSeverity: 'MEDIUM' });
  });

  it('administrators build a draft with every question type, validated; only drafts change', async () => {
    const t = (await as.admin.post('/pm-templates', { code: 'shelter_pm', name: 'Shelter PM' }).expect(201)).body.data;
    expect(t).toMatchObject({ code: 'SHELTER_PM', version: 1, status: 'DRAFT' });
    await as.admin.post(`/pm-templates/${t.id}/activate`).expect(422); // no questions yet
    const s = (await as.admin.post(`/pm-templates/${t.id}/sections`, { code: 'HVAC', name: 'Air conditioning', category: 'OTHER' }).expect(201)).body.data;
    const types = [
      { code: 'ac_running', prompt: 'Is the AC running?', failureOnAnswer: 'NO', requiresPhotoOnFailure: true },
      { code: 'ac_temp', prompt: 'Room temperature', responseType: 'NUMBER', unit: '°C' },
      { code: 'ac_notes', prompt: 'Notes', responseType: 'TEXT', isRequired: false },
      { code: 'ac_brand', prompt: 'Brand', responseType: 'SELECT', options: ['LG', 'Samsung'] },
      { code: 'ac_faults', prompt: 'Faults seen', responseType: 'MULTI_SELECT', options: ['Leak', 'Noise'], isRequired: false },
      { code: 'ac_serviced', prompt: 'Last service', responseType: 'DATE' },
      { code: 'ac_checked', prompt: 'Checked at', responseType: 'DATETIME' },
      { code: 'ac_photo', prompt: 'Photo of the unit', responseType: 'PHOTO' },
    ];
    for (const body of types) await as.admin.post(`/pm-sections/${s.id}/items`, body).expect(201);
    for (const bad of [
      { code: 'x1', prompt: 'Pick', responseType: 'SELECT' },
      { code: 'x2', prompt: 'Temp', responseType: 'NUMBER', failureOnAnswer: 'YES' },
      { code: 'x3', prompt: 'Temp', responseType: 'NUMBER', minValue: 10, maxValue: 5 },
      { code: 'x4', prompt: 'Ok?', minValue: 1 },
      { code: 'ac_running', prompt: 'Duplicate code' },
    ]) {
      const res = await as.admin.post(`/pm-sections/${s.id}/items`, bad);
      expect([409, 422]).toContain(res.status);
    }
    const f = (await as.admin.post(`/pm-sections/${s.id}/reading-fields`, { code: 'set_point', label: 'Set point', unit: '°C', isRequired: true }).expect(201)).body.data;
    // A PATCH is merged with the stored question and checked as a whole.
    const temp = (await as.admin.get(`/pm-templates/${t.id}`).expect(200)).body.data.sections[0].items.find((i: { code: string }) => i.code === 'ac_temp');
    await as.admin.patch(`/pm-items/${temp.id}`, { responseType: 'SELECT' }).expect(422);
    expect((await as.admin.patch(`/pm-items/${temp.id}`, { maxValue: 60 }).expect(200)).body.data).toMatchObject({ maxValue: 60, unit: '°C' });

    const active = (await as.admin.post(`/pm-templates/${t.id}/activate`).expect(200)).body.data;
    expect(active).toMatchObject({ status: 'ACTIVE', schedulesMoved: 0 });
    for (const res of [
      await as.admin.patch(`/pm-items/${temp.id}`, { maxValue: 70 }),
      await as.admin.patch(`/pm-reading-fields/${f.id}`, { unit: 'K' }),
      await as.admin.post(`/pm-templates/${t.id}/sections`, { code: 'NEW', name: 'New', category: 'OTHER' }),
      await as.admin.patch(`/pm-templates/${t.id}`, { name: 'Renamed' }),
    ]) {
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('TEMPLATE_NOT_DRAFT');
    }
    // …and the database refuses it too, whatever the caller.
    await expect(prisma.pmChecklistItem.update({ where: { id: temp.id }, data: { prompt: 'sneaky' } })).rejects.toThrow(/draft template version/);
  });

  it('a new version is a draft copy; activating it retires the old one and moves open schedules', async () => {
    const ref = (await as.admin.get('/pm-templates').expect(200)).body.data[0];
    const open = await schedule();
    const v2 = (await as.admin.post(`/pm-templates/${ref.id}/new-version`).expect(201)).body.data;
    expect(v2).toMatchObject({ code: ref.code, version: 2, status: 'DRAFT' });
    expect((await as.admin.post(`/pm-templates/${ref.id}/new-version`).expect(409)).body.error.code).toBe('DRAFT_EXISTS');
    const copy = (await as.admin.get(`/pm-templates/${v2.id}`).expect(200)).body.data;
    expect(copy.sections.flatMap((s: { items: unknown[] }) => s.items)).toHaveLength(69);
    const q = copy.sections[0].items[0];
    await as.admin.patch(`/pm-items/${q.id}`, { failureSeverity: 'HIGH' }).expect(200);
    const activated = (await as.admin.post(`/pm-templates/${v2.id}/activate`).expect(200)).body.data;
    expect(activated.schedulesMoved).toBe(1);
    const all = (await as.admin.get('/pm-templates').expect(200)).body.data;
    expect(all.map((x: { version: number; status: string }) => `${x.version}:${x.status}`)).toEqual(['2:ACTIVE', '1:RETIRED']);
    expect((await as.admin.get(`/pm-schedules/${open.id}`).expect(200)).body.data.templateId).toBe(v2.id);
    // Version 1 still has its original wording (visits on it keep their history).
    const v1 = (await as.admin.get(`/pm-templates/${ref.id}`).expect(200)).body.data;
    expect(v1.sections[0].items[0].failureSeverity).toBe('MEDIUM');
  });

  it('templates are managed by administrators only; everyone who does PM can read them', async () => {
    await as.supervisorA.post('/pm-templates', { code: 'X', name: 'X' }).expect(403);
    await as.tech1.post('/pm-templates', { code: 'X', name: 'X' }).expect(403);
    await as.tech1.get('/pm-consistency-rules').expect(200);
    await as.supervisorA.post('/pm-consistency-rules', { lhsKey: 'a.b', operator: '<=', rhsKey: 'a.c', message: 'x' }).expect(403);
  });
});

describe('schedules', () => {
  it('supervisors plan recurring PMs for assigned technicians in their regions', async () => {
    const res = await as.supervisorA
      .post('/pm-schedules', { siteId: ids.siteA, technicianId: ids.tech1, frequency: 'QUARTERLY', scheduledDate: '2030-01-31', dueDate: '2030-02-07', occurrences: 4, priority: 'HIGH' })
      .expect(201);
    const rows = res.body.data as { scheduledDate: string; dueDate: string; seriesId: string; status: string; priority: string }[];
    expect(rows.map((r) => `${r.scheduledDate}>${r.dueDate}`)).toEqual(['2030-01-31>2030-02-07', '2030-04-30>2030-05-07', '2030-07-31>2030-08-07', '2030-10-31>2030-11-07']);
    expect(new Set(rows.map((r) => r.seriesId)).size).toBe(1);
    expect(rows.every((r) => r.status === 'SCHEDULED' && r.priority === 'HIGH')).toBe(true);

    const refuse = async (body: Record<string, unknown>, who = as.supervisorA) => (await who.post('/pm-schedules', { siteId: ids.siteA, technicianId: ids.tech1, scheduledDate: today(), dueDate: today(), ...body })).body.error.code;
    expect(await refuse({ technicianId: ids.techB })).toBe('NOT_ASSIGNED');
    expect(await refuse({ siteId: ids.siteB })).toBe('INVALID_REFERENCE');
    expect(await refuse({ dueDate: addDaysIso(today(), -1) })).toBe('VALIDATION_FAILED');
    expect(await refuse({}, as.supervisorB)).toBe('INVALID_REFERENCE');
    await as.tech1.post('/pm-schedules', { siteId: ids.siteA, scheduledDate: today(), dueDate: today() }).expect(403);
  });

  it('past-due PMs are overdue; plans can be moved or cancelled while open', async () => {
    const late = await schedule(as.supervisorA, { scheduledDate: addDaysIso(today(), -10), dueDate: addDaysIso(today(), -3) });
    expect(late.status).toBe('OVERDUE');
    const s = await schedule();
    // Time passes: the plan's dates are now in the past.
    const past = (n: number) => new Date(`${addDaysIso(today(), n)}T00:00:00Z`);
    await prisma.pmSchedule.update({ where: { id: s.id }, data: { scheduledDate: past(-3), dueDate: past(-1) } });
    expect(await app.get(SchedulesService).markOverdue()).toBe(1);
    expect((await as.supervisorA.get(`/pm-schedules/${s.id}`).expect(200)).body.data.status).toBe('OVERDUE');
    const moved = await as.supervisorA.patch(`/pm-schedules/${s.id}`, { dueDate: addDaysIso(today(), 5) }).expect(200);
    expect(moved.body.data.status).toBe('SCHEDULED');
    await as.supervisorB.patch(`/pm-schedules/${s.id}`, { priority: 'LOW' }).expect(404);
    await as.supervisorA.post(`/pm-schedules/${s.id}/cancel`, {}).expect(422);
    expect((await as.supervisorA.post(`/pm-schedules/${s.id}/cancel`, { reason: 'Site access road flooded' }).expect(200)).body.data.status).toBe('CANCELLED');
    await as.supervisorA.post(`/pm-schedules/${s.id}/cancel`, { reason: 'again' }).expect(422);
  });

  it('technicians see the plans of their sites', async () => {
    await schedule();
    expect((await as.tech1.get('/pm-schedules?mine=true').expect(200)).body.meta.total).toBe(1);
    expect((await as.techB.get('/pm-schedules').expect(200)).body.meta.total).toBe(0);
  });
});

describe('visits', () => {
  it('the assigned technician starts a scheduled PM; sections for missing equipment start N/A; retries are idempotent', async () => {
    const s = await schedule();
    await as.techB.post('/visits', { scheduleId: s.id }).expect(403);
    await as.tech2.post('/visits', { scheduleId: s.id }).expect(403); // scheduled for tech1
    const id = crypto.randomUUID();
    const v = (await as.tech1.post('/visits', { id, scheduleId: s.id }).expect(201)).body.data as VisitDetail;
    expect(v).toMatchObject({ id, status: 'IN_PROGRESS', notApplicableSections: ['SOLAR'], completionPct: 0 });
    expect(v.issues.length).toBeGreaterThan(50);
    expect((await as.tech1.post('/visits', { id, scheduleId: s.id }).expect(201)).body.data.id).toBe(id);
    expect((await as.tech1.post('/visits', { scheduleId: s.id }).expect(201)).body.data.id).toBe(id);
    expect((await as.supervisorA.get(`/pm-schedules/${s.id}`).expect(200)).body.data.status).toBe('IN_PROGRESS');
    await as.techB.get(`/visits/${id}`).expect(404);
  });

  it('answers are checked against the template; one bad value rejects the batch and nothing is saved', async () => {
    const v = await startVisit();
    const res = await as.tech1
      .put(`/visits/${v.id}/answers`, {
        responses: [
          { checklistItemId: item(v, 'gen_automation_working').id, answer: 'YES' },
          { checklistItemId: item(v, 'gen_automation_working').id.replace(/.$/, '0'), answer: 'YES' },
          { checklistItemId: item(v, 'dc_phase_1_amps').id, numericValue: -3 },
          { checklistItemId: item(v, 'gen_radiator').id, numericValue: 4 },
        ],
        readings: [
          { readingFieldId: field(v, 'fuel_level').id, numericValue: 120 },
          { readingFieldId: field(v, 'oil_pressure').id, numericValue: 3 },
        ],
        notApplicableSections: ['SOLAR', 'DC_SYSTEM'],
      })
      .expect(422);
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual([
      'notApplicableSections.1',
      'responses.1.checklistItemId',
      'responses.2',
      'responses.3',
      'readings.0',
      'readings.1',
    ]);
    expect(await prisma.pmResponse.count({ where: { visitId: v.id } })).toBe(0);
  });

  it('records answers and readings, applies failure rules and keeps the newer of two phone edits', async () => {
    const v = await startVisit();
    const auto = item(v, 'gen_automation_working');
    const saved = (
      await as.tech1
        .put(`/visits/${v.id}/answers`, {
          responses: [{ checklistItemId: auto.id, answer: 'NO', clientUpdatedAt: '2026-09-15T10:00:00Z' }],
          readings: [
            { readingFieldId: field(v, 'running_hours').id, numericValue: 877 },
            { readingFieldId: field(v, 'oil_pressure').id, textValue: 'Okay' },
            { readingFieldId: field(v, 'fuel_level').id, numericValue: 12.7 },
          ],
          overallComments: 'Generator automation fault reported to supervisor.',
        })
        .expect(200)
    ).body.data as VisitDetail & { skipped: unknown[] };
    expect(saved.failureCount).toBe(1);
    expect(saved.responses[0]).toMatchObject({ answer: 'NO', isFailure: true });
    expect(saved.readings.find((r) => r.readingFieldId === field(v, 'fuel_level').id)?.numericValue).toBe(12.7);
    expect(saved.issues.filter((i) => i.refId === auto.id).map((i) => i.kind)).toEqual(['COMMENT_REQUIRED', 'PHOTO_REQUIRED']);
    expect(saved.completionPct).toBeGreaterThan(0);

    // An older edit (e.g. synced late from a second phone) does not overwrite the newer one.
    const late = (await as.tech1.put(`/visits/${v.id}/answers`, { responses: [{ checklistItemId: auto.id, answer: 'YES', clientUpdatedAt: '2026-09-15T09:00:00Z' }] }).expect(200)).body.data;
    expect(late.skipped).toEqual([{ type: 'response', id: auto.id }]);
    expect(late.responses[0].answer).toBe('NO');
    // Sending no value clears the answer.
    const cleared = (await as.tech1.put(`/visits/${v.id}/answers`, { responses: [{ checklistItemId: auto.id }] }).expect(200)).body.data;
    expect(cleared.responses).toHaveLength(0);
    expect(cleared.failureCount).toBe(0);
    // Only the visit's technician can change it.
    expect((await as.tech2.put(`/visits/${v.id}/answers`, { responses: [] }).expect(403)).body.error.code).toBe('NOT_YOUR_VISIT');
  });

  it('completes only when nothing is missing, then a supervisor reviews it', async () => {
    const s = await schedule();
    const v = await startVisit(as.tech1, s.id);
    const blocked = await as.tech1.post(`/visits/${v.id}/complete`).expect(422);
    expect(blocked.body.error.code).toBe('VISIT_INCOMPLETE');
    expect(blocked.body.error.details.length).toBeGreaterThan(50);

    const filled = await fillAll(as.tech1, v);
    expect(filled.completionPct).toBe(100);
    const done = (await as.tech1.post(`/visits/${v.id}/complete`).expect(200)).body.data;
    expect(done).toMatchObject({ status: 'COMPLETED', completionPct: 100, failureCount: 0, issues: [] });
    expect((await as.supervisorA.get(`/pm-schedules/${s.id}`).expect(200)).body.data.status).toBe('COMPLETED');
    expect((await as.tech1.put(`/visits/${v.id}/answers`, { responses: [] }).expect(409)).body.error.code).toBe('VISIT_LOCKED');

    await as.tech1.post(`/visits/${v.id}/review`, { decision: 'APPROVE' }).expect(403);
    await as.supervisorB.post(`/visits/${v.id}/review`, { decision: 'APPROVE' }).expect(404);
    await as.supervisorA.post(`/visits/${v.id}/review`, { decision: 'REJECT' }).expect(422);
    const rejected = (await as.supervisorA.post(`/visits/${v.id}/review`, { decision: 'REJECT', comments: 'Fuel level photo missing' }).expect(200)).body.data;
    expect(rejected).toMatchObject({ status: 'REJECTED', reviewComments: 'Fuel level photo missing' });
    // Returned to the technician: editable again, then completed and approved.
    const reopened = (await as.tech1.put(`/visits/${v.id}/answers`, { overallComments: 'Photo added' }).expect(200)).body.data;
    expect(reopened.status).toBe('IN_PROGRESS');
    await as.tech1.post(`/visits/${v.id}/complete`).expect(200);
    const approved = (await as.supervisorA.post(`/visits/${v.id}/review`, { decision: 'APPROVE' }).expect(200)).body.data;
    expect(approved).toMatchObject({ status: 'APPROVED', reviewedBy: { id: as.supervisorA.session.user.id } });
    expect((await as.supervisorA.get(`/pm-schedules/${s.id}`).expect(200)).body.data.status).toBe('APPROVED');
  });

  it('consistency rules block completion: operational modules cannot exceed installed ones', async () => {
    const v = await startVisit();
    await fillAll(as.tech1, v);
    const bad = (
      await as.tech1
        .put(`/visits/${v.id}/answers`, {
          readings: [
            { readingFieldId: field(v, 'dc_modules_installed').id, numericValue: 3 },
            { readingFieldId: field(v, 'dc_modules_operational').id, numericValue: 4 },
          ],
        })
        .expect(200)
    ).body.data as VisitDetail;
    expect(bad.issues).toEqual([expect.objectContaining({ kind: 'INCONSISTENT', label: 'DC Modules Operational cannot exceed DC Modules Installed.' })]);
    await as.tech1.post(`/visits/${v.id}/complete`).expect(422);
  });

  it('photos: images only, size-limited, visible to those who may see the visit, satisfy photo requirements', async () => {
    const v = await startVisit();
    const ext = item(v, 'nt_fire_extinguisher');
    await as.tech1.put(`/visits/${v.id}/answers`, { responses: [{ checklistItemId: ext.id, answer: 'YES' }] }).expect(200);
    const before = (await as.tech1.get(`/visits/${v.id}`).expect(200)).body.data as VisitDetail;
    expect(before.issues.filter((i) => i.refId === ext.id).map((i) => i.kind)).toEqual(['PHOTO_REQUIRED']);

    const photoId = crypto.randomUUID();
    const up = (await uploadPhoto(as.tech1, v.id, { id: photoId, checklistItemId: ext.id, caption: 'Expiry 2027-03' }).expect(201)).body.data;
    expect(up).toMatchObject({ id: photoId, contentType: 'image/jpeg', sizeBytes: JPEG.length, checklistItemId: ext.id });
    expect(up).not.toHaveProperty('storageKey');
    expect((await uploadPhoto(as.tech1, v.id, { id: photoId, checklistItemId: ext.id }).expect(201)).body.data.id).toBe(photoId);
    const after = (await as.tech1.get(`/visits/${v.id}`).expect(200)).body.data as VisitDetail;
    expect(after.issues.some((i) => i.refId === ext.id)).toBe(false);

    const file = await request(http).get(`/api/v1/visits/${v.id}/photos/${photoId}`).set('Authorization', `Bearer ${as.supervisorA.session.accessToken}`).buffer(true).expect(200);
    expect(file.headers['content-type']).toBe('image/jpeg');
    expect(Buffer.compare(file.body as Buffer, JPEG)).toBe(0);
    await request(http).get(`/api/v1/visits/${v.id}/photos/${photoId}`).set('Authorization', `Bearer ${as.techB.session.accessToken}`).expect(404);

    expect((await uploadPhoto(as.tech1, v.id, {}, Buffer.from('not an image at all'), 'x.jpg').expect(415)).body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    await uploadPhoto(as.tech1, v.id, {}, Buffer.concat([JPEG, Buffer.alloc(250_000)])).expect(413);
    await uploadPhoto(as.tech2, v.id).expect(403);
    await request(http).post(`/api/v1/visits/${v.id}/photos`).set('Authorization', `Bearer ${as.tech1.session.accessToken}`).expect(422);

    await as.tech1.post(`/visits/${v.id}/photos/${photoId}`).expect(404);
    await request(http).delete(`/api/v1/visits/${v.id}/photos/${photoId}`).set('Authorization', `Bearer ${as.tech1.session.accessToken}`).expect(204);
    await request(http).get(`/api/v1/visits/${v.id}/photos/${photoId}`).set('Authorization', `Bearer ${as.tech1.session.accessToken}`).expect(404);
  });

  it('lists visits by scope', async () => {
    await startVisit();
    expect((await as.tech1.get('/visits?mine=true').expect(200)).body.meta.total).toBe(1);
    expect((await as.supervisorA.get('/visits').expect(200)).body.meta.total).toBe(1);
    expect((await as.supervisorB.get('/visits').expect(200)).body.meta.total).toBe(0);
  });
});

describe('demo data', () => {
  it('the Tienii visit: completed, with the report’s readings; completion computed, not invented; removable', async () => {
    const demo = await seedDemoData(prisma);
    expect(demo.visitId).not.toBeNull();
    const visit = await prisma.pmVisit.findUniqueOrThrow({ where: { id: demo.visitId! }, include: { readings: true, responses: true, site: true } });
    expect(visit).toMatchObject({ status: 'COMPLETED', isDemo: true, notApplicableSections: ['SOLAR'] });
    expect(visit.site.siteCode).toBe(DEMO.siteCode);
    const byLabel = Object.fromEntries(visit.readings.map((r) => [r.labelSnapshot, r.textValue ?? Number(r.numericValue)]));
    expect(byLabel).toMatchObject({
      'Running Hours': 877,
      'Oil Pressure': 'Okay',
      'Fuel Level (%)': 12.7,
      'Generator KVA': 20,
      'Rectifier Output Voltage (V)': 52.99,
      'Load Current (A)': 52.7,
      'Number of Rectifier Modules': 6,
      'DC Modules Installed': 3,
      'DC Modules Operational': 3,
      'Battery Voltage (V)': 52.5,
      'Battery Capacity (Ah)': 200,
      'Number of Battery Strings': 8,
    });
    expect(visit.responses).toHaveLength(0);
    // Power-module records: measured values as recorded, DC kW calculated (52.99 V × 52.7 A / 1000).
    const dc = await prisma.dcReading.findUniqueOrThrow({ where: { visitId: visit.id } });
    expect([dc.dcPowerKw!.toString(), dc.rectifierModuleCount, dc.dcModulesInstalled, dc.dcModulesOperational]).toEqual(['2.792573', 6, 3, 3]);
    const gen = await prisma.generatorReading.findUniqueOrThrow({ where: { visitId: visit.id } });
    expect([Number(gen.runningHours), gen.oilPressure, Number(gen.fuelLevelPct), Number(gen.generatorKva)]).toEqual([877, 'Okay', 12.7, 20]);
    expect(await prisma.solarReading.count({ where: { visitId: visit.id } })).toBe(0);
    expect(Number(visit.completionPct)).toBeLessThan(100);
    expect((await seedDemoData(prisma)).visitId).toBe(demo.visitId); // idempotent
    const removed = await removeDemoData(prisma);
    expect(removed).toMatchObject({ visits: 1, schedules: 1 });
    expect(await prisma.pmVisit.count()).toBe(0);
  });
});
