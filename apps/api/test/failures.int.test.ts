import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AssignmentsService } from '../src/assignments/assignments.service.js';
import { syncVisitFailures } from '../src/failures/failure-engine.js';
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
let as: Record<'admin' | 'supervisorA' | 'supervisorB' | 'tech1' | 'tech2' | 'maintA' | 'maintNoScope', As>;
let ids: Record<'siteA' | 'siteB' | 'tech1' | 'tech2' | 'supervisorA' | 'maintA' | 'maintNoScope', string>;

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');

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
  const siteA = await org.createSite({ siteCode: 'A-1', siteName: 'Site A', regionId: a.region.id, generatorAvailable: true }, null);
  const siteB = await org.createSite({ siteCode: 'B-1', siteName: 'Site B', regionId: b.region.id }, null);
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
  const maintA = await make(['MAINTENANCE_USER'], { regionScopeIds: [a.region.id] });
  const maintNoScope = await make(['MAINTENANCE_USER']);
  await app.get(AssignmentsService).assign({ siteId: siteA.id, userId: tech1.id, role: 'TECHNICIAN', startDate: '2026-09-01' }, admin.id);
  ids = { siteA: siteA.id, siteB: siteB.id, tech1: tech1.id, tech2: tech2.id, supervisorA: supervisorA.id, maintA: maintA.id, maintNoScope: maintNoScope.id };
  as = {
    admin: await signIn(http, admin.email),
    supervisorA: await signIn(http, supervisorA.email),
    supervisorB: await signIn(http, supervisorB.email),
    tech1: await signIn(http, tech1.email),
    tech2: await signIn(http, tech2.email),
    maintA: await signIn(http, maintA.email),
    maintNoScope: await signIn(http, maintNoScope.email),
  };
});

interface Item {
  id: string;
  code: string;
  responseType: string;
  isRequired: boolean;
  minValue: number | null;
  failureOnAnswer: 'YES' | 'NO' | null;
  requiresPhotoOnFailure: boolean;
  requiresCommentOnFailure: boolean;
  photoOnAnswers: string[];
  commentOnAnswers: string[];
}
interface Visit {
  id: string;
  notApplicableSections: string[];
  sections: { code: string; items: Item[]; readingFields: { id: string; valueType: string }[] }[];
}

/**
 * Completes a PM at site A as tech1: every required answer given; the
 * questions in `failing` get their failure answer (with the comment and photo
 * the template asks for), the others their passing answer.
 */
async function completePm(failing: string[], visitId?: string) {
  const v: Visit = visitId
    ? (await as.tech1.get(`/visits/${visitId}`).expect(200)).body.data
    : (await as.tech1.post('/visits', { siteId: ids.siteA }).expect(201)).body.data;
  const responses: Record<string, unknown>[] = [];
  const readings: Record<string, unknown>[] = [];
  const photos: string[] = [];
  for (const s of v.sections) {
    if (v.notApplicableSections.includes(s.code)) continue;
    for (const i of s.items) {
      if (i.responseType === 'YES_NO_NA') {
        const fail = failing.includes(i.code);
        const answer = fail ? i.failureOnAnswer! : i.failureOnAnswer === 'YES' ? 'NO' : 'YES';
        const comment = (fail && i.requiresCommentOnFailure) || i.commentOnAnswers.includes(answer);
        responses.push({ checklistItemId: i.id, answer, comment: comment ? `Found on site: ${i.code}` : null });
        if (((fail && i.requiresPhotoOnFailure) || i.photoOnAnswers.includes(answer)) && !visitId) photos.push(i.id);
      } else if (i.responseType === 'NUMBER' && i.isRequired) {
        responses.push({ checklistItemId: i.id, numericValue: i.minValue ?? 0 });
      }
    }
    for (const f of s.readingFields) readings.push(f.valueType === 'NUMBER' ? { readingFieldId: f.id, numericValue: 3 } : { readingFieldId: f.id, textValue: 'Okay' });
  }
  const saved = await as.tech1.put(`/visits/${v.id}/answers`, { responses, readings });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  for (const itemId of photos) await as.tech1.upload(`/visits/${v.id}/photos`, JPEG, 'p.jpg', { checklistItemId: itemId }).expect(201);
  await as.tech1.put(`/visits/${v.id}/signature`, { width: 300, height: 100, strokes: [[[10, 50], [80, 20]]] }).expect(200);
  const done = await as.tech1.post(`/visits/${v.id}/complete`);
  expect(done.status, JSON.stringify(done.body)).toBe(200);
  return v.id;
}

const failuresOf = async (visitId: string, who: As = as.supervisorA) => (await who.get(`/failures?visitId=${visitId}`).expect(200)).body.data as { id: string; number: string; title: string; status: string; stillReported: boolean; severity: string; source: string }[];

describe('failure engine', () => {
  it('a completed PM records one failure per failed answer; running it again changes nothing', async () => {
    const visitId = await completePm(['gen_automation_working', 'gen_burning_oil']);
    const list = await failuresOf(visitId);
    expect(list.map((f) => [f.number, f.title, f.status, f.source, f.severity]).sort()).toEqual([
      ['FL-000001', expect.any(String), 'OPEN', 'PM_CHECKLIST', 'MEDIUM'],
      ['FL-000002', expect.any(String), 'OPEN', 'PM_CHECKLIST', 'MEDIUM'],
    ]);
    expect(list.map((f) => f.title).sort()).toEqual(['Is Automation Working?', 'Is The Machine burning Oil?']);
    const detail = (await as.tech1.get(`/failures/${list[0]!.id}`).expect(200)).body.data;
    expect(detail.description).toMatch(/^Answered (YES|NO): Found on site/);
    expect(detail.updates).toMatchObject([{ kind: 'SYSTEM', body: 'Recorded from the completed PM.' }]);

    const visit = await prisma.pmVisit.findUniqueOrThrow({ where: { id: visitId } });
    const again = await prisma.$transaction((tx) => syncVisitFailures(tx, visit));
    expect(again).toEqual({ created: [], updated: [], removed: [], noLongerReported: [] });
    expect(await prisma.failure.count()).toBe(2);
  });

  it('a corrected PM: untouched failures disappear, failures being worked on are marked no longer reported', async () => {
    const visitId = await completePm(['gen_automation_working', 'gen_burning_oil']);
    const all = await failuresOf(visitId);
    const f1 = all.find((f) => f.title === 'Is Automation Working?');
    const f2 = all.find((f) => f.title === 'Is The Machine burning Oil?');
    // Work has started on one of them.
    await as.supervisorA.post('/corrective-actions', { failureId: f1!.id, title: 'Replace controller' }).expect(201);
    await as.supervisorA.post(`/visits/${visitId}/review`, { decision: 'REJECT', comments: 'Recheck the generator' }).expect(200);
    await completePm([], visitId);
    const after = await failuresOf(visitId);
    expect(after.map((f) => f.id)).toEqual([f1!.id]);
    expect(after[0]).toMatchObject({ stillReported: false });
    expect(await prisma.failure.count({ where: { id: f2!.id } })).toBe(0);
    // Failing again: reported again, never duplicated.
    await as.supervisorA.post(`/visits/${visitId}/review`, { decision: 'REJECT', comments: 'Automation still failing' }).expect(200);
    await completePm(['gen_automation_working'], visitId);
    const again = await failuresOf(visitId);
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({ id: f1!.id, stillReported: true });
  });
});

describe('corrective-action workflow', () => {
  it('assign → start → complete → verify (rework) → close; the failure follows', async () => {
    const [f] = await failuresOf(await completePm(['gen_automation_working']));
    const status = async () => (await as.supervisorA.get(`/failures/${f!.id}`).expect(200)).body.data.status;

    const created = (await as.supervisorA.post('/corrective-actions', { failureId: f!.id, title: 'Replace ATS controller', priority: 'HIGH', assignedToId: ids.tech1, dueDate: '2026-10-01' }).expect(201)).body.data;
    expect(created).toMatchObject({ number: 'CA-000001', status: 'ASSIGNED', assignedTo: { id: ids.tech1 }, dueDate: '2026-10-01' });
    expect(await status()).toBe('ASSIGNED');
    const id = created.id;

    await as.tech2.post(`/corrective-actions/${id}/start`).expect(404); // not at this site, not assigned
    await as.tech1.post(`/corrective-actions/${id}/complete`, { note: 'x' }).expect(409); // not started
    await as.tech1.post(`/corrective-actions/${id}/start`).expect(200);
    expect(await status()).toBe('IN_PROGRESS');

    await as.tech1.post(`/corrective-actions/${id}/comments`, { body: 'Controller ordered' }).expect(201);
    const photo = (await as.tech1.upload(`/corrective-actions/${id}/attachments`, JPEG, 'before.jpg', { caption: 'Before' }).expect(201)).body.data;
    expect(photo).toMatchObject({ kind: 'PHOTO', contentType: 'image/jpeg', fileName: 'before.jpg', correctiveActionId: id });
    const doc = (await as.tech1.upload(`/corrective-actions/${id}/attachments`, PDF, 'invoice.pdf').expect(201)).body.data;
    expect(doc).toMatchObject({ kind: 'DOCUMENT', contentType: 'application/pdf' });
    const file = await as.tech1.get(`/failures/${f!.id}/attachments/${doc.id}`).expect(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(file.headers['content-disposition']).toMatch(/^attachment; filename="invoice.pdf"/);
    await as.tech1.upload(`/corrective-actions/${id}/attachments`, Buffer.from('<html>'), 'x.html').expect(415);

    await as.tech1.post(`/corrective-actions/${id}/complete`, {}).expect(422);
    await as.tech1.post(`/corrective-actions/${id}/complete`, { note: 'Replaced the ATS controller' }).expect(200);
    expect(await status()).toBe('RESOLVED');

    await as.tech1.post(`/corrective-actions/${id}/verify`, { decision: 'APPROVE' }).expect(403); // technicians do not verify
    await as.supervisorA.post(`/corrective-actions/${id}/verify`, { decision: 'REJECT' }).expect(422);
    const back = (await as.supervisorA.post(`/corrective-actions/${id}/verify`, { decision: 'REJECT', note: 'Automation still not switching' }).expect(200)).body.data;
    expect(back).toMatchObject({ status: 'IN_PROGRESS', completedAt: null, completionNote: null });
    expect(await status()).toBe('IN_PROGRESS');
    await as.tech1.post(`/corrective-actions/${id}/complete`, { note: 'Rewired the sensor' }).expect(200);
    await as.supervisorA.post(`/corrective-actions/${id}/close`, {}).expect(409); // not verified yet
    await as.supervisorA.post(`/corrective-actions/${id}/verify`, { decision: 'APPROVE', note: 'Tested on site' }).expect(200);
    expect(await status()).toBe('VERIFIED');
    const closed = (await as.supervisorA.post(`/corrective-actions/${id}/close`, {}).expect(200)).body.data;
    expect(closed).toMatchObject({ status: 'CLOSED', closedBy: { id: ids.supervisorA } });

    const failure = (await as.supervisorA.get(`/failures/${f!.id}`).expect(200)).body.data;
    expect(failure).toMatchObject({ status: 'CLOSED', closedBy: null });
    expect(failure.resolvedAt && failure.verifiedAt && failure.closedAt).toBeTruthy();
    const trail = failure.updates.map((u: { kind: string; fromStatus: string | null; toStatus: string | null }) => `${u.kind}:${u.fromStatus ?? ''}>${u.toStatus ?? ''}`);
    expect(trail).toEqual([
      'SYSTEM:>',
      'STATUS:>ASSIGNED', // action created
      'STATUS:OPEN>ASSIGNED', // failure
      'STATUS:ASSIGNED>IN_PROGRESS',
      'STATUS:ASSIGNED>IN_PROGRESS',
      'COMMENT:>',
      'STATUS:IN_PROGRESS>COMPLETED',
      'STATUS:IN_PROGRESS>RESOLVED',
      'STATUS:COMPLETED>IN_PROGRESS',
      'STATUS:RESOLVED>IN_PROGRESS',
      'STATUS:IN_PROGRESS>COMPLETED',
      'STATUS:IN_PROGRESS>RESOLVED',
      'STATUS:COMPLETED>VERIFIED',
      'STATUS:RESOLVED>VERIFIED',
      'STATUS:VERIFIED>CLOSED',
      'STATUS:VERIFIED>CLOSED',
    ]);
    // Closed: no more files.
    await as.tech1.upload(`/failures/${f!.id}/attachments`, JPEG, 'late.jpg').expect(409);
  });

  it('who may be assigned, and who may verify', async () => {
    const [f] = await failuresOf(await completePm(['gen_automation_working']));
    const create = (assignedToId: string) => as.supervisorA.post('/corrective-actions', { failureId: f!.id, title: 'Fix', assignedToId });
    expect((await create(ids.supervisorA).expect(422)).body.error.code).toBe('INVALID_ASSIGNEE'); // does not work on actions
    expect((await create(ids.maintNoScope).expect(422)).body.error.code).toBe('INVALID_ASSIGNEE'); // not at this site
    expect((await create(ids.tech2).expect(422)).body.error.code).toBe('INVALID_ASSIGNEE'); // not assigned to the site

    const action = (await create(ids.maintA).expect(201)).body.data;
    // The maintenance user sees the failure through the action, and works it.
    await as.maintA.get(`/failures/${f!.id}`).expect(200);
    expect((await as.maintA.get('/corrective-actions?assignedTo=me').expect(200)).body.data.map((a: { id: string }) => a.id)).toEqual([action.id]);
    await as.maintA.post(`/corrective-actions/${action.id}/start`).expect(200);
    await as.maintA.post(`/corrective-actions/${action.id}/complete`, { note: 'Done' }).expect(200);
    // Reassigning to the supervisor is refused, and the supervisor of region B cannot verify.
    await as.supervisorB.post(`/corrective-actions/${action.id}/verify`, { decision: 'APPROVE' }).expect(404);
    await as.admin.post(`/corrective-actions/${action.id}/verify`, { decision: 'APPROVE' }).expect(200);
  });

  it('the person who did the work cannot verify it', async () => {
    const [f] = await failuresOf(await completePm(['gen_automation_working']));
    // An administrator can also work on actions; assigned to themselves, they cannot verify their own work.
    const adminId = (await as.admin.get('/auth/me').expect(200)).body.data.id;
    await prisma.siteAssignment.create({ data: { siteId: ids.siteA, userId: adminId, role: 'SUPERVISOR', startDate: new Date('2026-09-01') } });
    const a = (await as.admin.post('/corrective-actions', { failureId: f!.id, title: 'Fix', assignedToId: adminId }).expect(201)).body.data;
    await as.admin.post(`/corrective-actions/${a.id}/start`).expect(200);
    await as.admin.post(`/corrective-actions/${a.id}/complete`, { note: 'Done' }).expect(200);
    expect((await as.admin.post(`/corrective-actions/${a.id}/verify`, { decision: 'APPROVE' }).expect(403)).body.error.code).toBe('SAME_PERSON');
  });

  it('a failure closes by hand only when no action is open; withdrawing needs a note; reopening starts again', async () => {
    const [f] = await failuresOf(await completePm(['gen_automation_working']));
    const a = (await as.supervisorA.post('/corrective-actions', { failureId: f!.id, title: 'Fix', assignedToId: ids.tech1 }).expect(201)).body.data;
    expect((await as.supervisorA.post(`/failures/${f!.id}/close`, { note: 'Not needed' }).expect(409)).body.error.code).toBe('ACTIONS_OPEN');
    await as.supervisorA.post(`/corrective-actions/${a.id}/close`, {}).expect(422);
    await as.supervisorA.post(`/corrective-actions/${a.id}/close`, { note: 'Duplicate of the vendor job' }).expect(200);
    expect((await as.supervisorA.get(`/failures/${f!.id}`).expect(200)).body.data.status).toBe('OPEN'); // withdrawn does not count
    await as.supervisorA.post(`/failures/${f!.id}/close`, {}).expect(422);
    await as.tech1.post(`/failures/${f!.id}/close`, { note: 'x' }).expect(403);
    const closed = (await as.supervisorA.post(`/failures/${f!.id}/close`, { note: 'Vendor fixed it under warranty' }).expect(200)).body.data;
    expect(closed).toMatchObject({ status: 'CLOSED', closeNote: 'Vendor fixed it under warranty', closedBy: { id: ids.supervisorA } });
    await as.supervisorA.post('/corrective-actions', { failureId: f!.id, title: 'Late' }).expect(409);
    const reopened = (await as.supervisorA.post(`/failures/${f!.id}/reopen`, { note: 'Failed again' }).expect(200)).body.data;
    expect(reopened).toMatchObject({ status: 'OPEN', closedAt: null, closeNote: null });
  });
});

describe('failures reported on site, scope and edits', () => {
  it('a technician reports a failure at an assigned site (retries return the same one)', async () => {
    const id = '0b6f3a52-6a8f-4b39-9a0e-3f4a3c1d2e11';
    const body = { id, siteId: ids.siteA, title: 'Fence broken at the gate', severity: 'LOW', category: 'NON_TECHNICAL' };
    const f = (await as.tech1.post('/failures', body).expect(201)).body.data;
    expect(f).toMatchObject({ id, number: 'FL-000001', source: 'MANUAL', status: 'OPEN', reportedBy: { id: ids.tech1 } });
    expect((await as.tech1.post('/failures', body).expect(201)).body.data.id).toBe(id);
    await as.tech1.post('/failures', { ...body, id: undefined, siteId: ids.siteB }).expect(422); // not their site
    await as.tech1.upload(`/failures/${id}/attachments`, JPEG, 'fence.jpg').expect(201);
  });

  it('scope: other regions and unassigned technicians do not see a failure', async () => {
    const [f] = await failuresOf(await completePm(['gen_automation_working']));
    await as.supervisorB.get(`/failures/${f!.id}`).expect(404);
    await as.tech2.get(`/failures/${f!.id}`).expect(404);
    expect((await as.supervisorB.get('/failures').expect(200)).body.data).toEqual([]);
    await as.supervisorB.patch(`/failures/${f!.id}`, { severity: 'HIGH' }).expect(404);
    await as.supervisorB.post('/corrective-actions', { failureId: f!.id, title: 'x' }).expect(422);
    await as.maintNoScope.get('/corrective-actions').expect(200);
  });

  it('supervisors change severity (recorded on the timeline); search by number', async () => {
    const [f] = await failuresOf(await completePm(['gen_automation_working']));
    await as.tech1.patch(`/failures/${f!.id}`, { severity: 'HIGH' }).expect(403);
    const changed = (await as.supervisorA.patch(`/failures/${f!.id}`, { severity: 'CRITICAL' }).expect(200)).body.data;
    expect(changed.severity).toBe('CRITICAL');
    expect(changed.updates.at(-1)).toMatchObject({ kind: 'SYSTEM', body: 'Severity changed from MEDIUM to CRITICAL.', author: { id: ids.supervisorA } });
    expect((await as.supervisorA.get('/failures?q=FL-000001').expect(200)).body.data.map((x: { id: string }) => x.id)).toEqual([f!.id]);
    expect((await as.supervisorA.get('/failures?status=active&severity=CRITICAL').expect(200)).body.meta.total).toBe(1);
  });

  it('attachments: only the uploader or a supervisor removes one', async () => {
    const [f] = await failuresOf(await completePm(['gen_automation_working']));
    const att = (await as.tech1.upload(`/failures/${f!.id}/attachments`, JPEG, 'a.jpg').expect(201)).body.data;
    await as.maintA.del(`/failures/${f!.id}/attachments/${att.id}`).expect(403);
    await as.supervisorA.del(`/failures/${f!.id}/attachments/${att.id}`).expect(204);
    await as.tech1.get(`/failures/${f!.id}/attachments/${att.id}`).expect(404);
  });
});
