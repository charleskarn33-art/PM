import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../lib/api/session-client';
import type { VisitDetail } from '../lib/api/types';
import { migrate, OfflineStore } from './store';
import { SyncEngine, type SyncApi } from './sync';
import { memoryDb, PACK, SITE, USER } from './test-fixtures';
import { applyOp, judge, startVisitLocally, type Op, type OpInput } from './visit-ops';

const T0 = '2026-09-20T08:00:00.000Z';

/** A stand-in for the API: keeps visits, applies changes like the server, can go offline or refuse. */
class FakeApi implements SyncApi {
  offline = false;
  refuse: { path: RegExp; error: ApiError } | null = null;
  failNext: ApiError[] = [];
  visits = new Map<string, VisitDetail>();
  calls: string[] = [];
  uploads: string[] = [];

  private apply(id: string, input: OpInput) {
    const v = this.visits.get(id)!;
    const next = judge(applyOp(v, { ...input, seq: 0, visitId: id, status: 'SYNCING', attempts: 0, nextAttemptAt: 0, lastError: null, createdAt: T0 } as Op));
    this.visits.set(id, { ...next, photos: next.photos.map(({ localUri: _l, ...p }) => p) });
    return this.visits.get(id)!;
  }

  private check(method: string, path: string) {
    this.calls.push(`${method} ${path}`);
    if (this.offline) throw new ApiError(0, 'OFFLINE', 'No connection to the server.');
    const fail = this.failNext.shift();
    if (fail) throw fail;
    if (this.refuse?.path.test(`${method} ${path}`)) throw this.refuse.error;
  }

  async request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<{ data: T }> {
    const method = init.method ?? 'GET';
    this.check(method, path);
    const body = init.body as never;
    if (path === '/field/pack') return { data: { ...PACK, visits: [...this.visits.values()] } as T };
    if (method === 'POST' && path === '/visits') {
      const input = body as { id: string };
      if (!this.visits.has(input.id)) {
        const r = startVisitLocally(PACK, { ...(body as object), technicianId: USER } as never);
        if (!r.ok) throw new ApiError(422, r.code, r.message);
        this.visits.set(input.id, r.visit);
      }
      return { data: this.visits.get(input.id) as T };
    }
    const [, id, action, sub] = path.match(/^\/visits\/([^/]+)\/?([^/]*)\/?(.*)$/) ?? [];
    if (!id || !this.visits.has(id)) throw new ApiError(404, 'NOT_FOUND', 'Visit not found.');
    const locked = () => {
      if (!['IN_PROGRESS', 'REJECTED'].includes(this.visits.get(id)!.status)) throw new ApiError(409, 'VISIT_LOCKED', 'This PM is completed and can no longer be changed.');
    };
    if (method === 'GET') return { data: this.visits.get(id) as T };
    locked();
    if (action === 'answers') return { data: { ...this.apply(id, { kind: 'answers', payload: body }), skipped: [] } as T };
    if (action === 'battery-units') return { data: this.apply(id, { kind: 'battery', payload: body }) as T };
    if (action === 'signature') return { data: this.apply(id, { kind: 'sign', payload: body }) as T };
    if (action === 'complete') {
      if (this.visits.get(id)!.issues.length) throw new ApiError(422, 'VISIT_INCOMPLETE', 'Unable to complete.');
      return { data: this.apply(id, { kind: 'complete', payload: {} }) as T };
    }
    if (action === 'photos' && method === 'DELETE') {
      if (!this.visits.get(id)!.photos.some((p) => p.id === sub)) throw new ApiError(404, 'NOT_FOUND', 'Photo not found.');
      this.apply(id, { kind: 'photo_delete', payload: { photoId: sub! } });
      return { data: undefined as T };
    }
    throw new Error(`unexpected ${method} ${path}`);
  }

  async upload<T>(path: string, form: FormData): Promise<{ data: T }> {
    this.check('POST', path);
    const id = path.split('/')[2]!;
    const photoId = String(form.get('id'));
    this.uploads.push(photoId);
    this.apply(id, { kind: 'photo', payload: { id: photoId, localUri: '', checklistItemId: (form.get('checklistItemId') as string) || null, takenAt: T0 } });
    return { data: { id: photoId } as T };
  }
}

let db: ReturnType<typeof memoryDb>;
let store: OfflineStore;
let api: FakeApi;
let engine: SyncEngine;
let now: number;
let deleted: string[];

beforeEach(async () => {
  db = memoryDb();
  await migrate(db);
  await migrate(db); // idempotent
  now = Date.parse(T0);
  store = new OfflineStore(db, USER, () => new Date(now));
  api = new FakeApi();
  deleted = [];
  engine = new SyncEngine({
    store,
    api,
    photoForm: (p) => {
      const f = new FormData();
      f.append('id', p.id);
      if (p.checklistItemId) f.append('checklistItemId', p.checklistItemId);
      return f;
    },
    deleteFile: (uri) => deleted.push(uri),
    now: () => now,
    random: () => 0.5,
  });
});

/** Starts a visit on the phone exactly as the app does. */
async function startOffline(id = 'v-1') {
  const payload = { id, siteId: SITE.id, clientCreatedAt: T0 };
  const r = startVisitLocally(PACK, { ...payload, technicianId: USER });
  if (!r.ok) throw new Error(r.message);
  await store.saveBase(r.visit, false);
  await store.enqueue(id, { kind: 'start', payload });
}

const answers = (itemAnswer: 'YES' | 'NO', volts: number, at = T0): OpInput => ({
  kind: 'answers',
  payload: {
    responses: [{ checklistItemId: 'i-clean', answer: itemAnswer, numericValue: null, textValue: null, selectedOptions: null, dateValue: null, datetimeValue: null, comment: null, clientUpdatedAt: at }],
    readings: [{ readingFieldId: 'f-volt', numericValue: volts, textValue: null, clientUpdatedAt: at }],
  },
});

describe('offline store', () => {
  it('keeps a visit started offline with its changes, joined into one request, per user', async () => {
    await startOffline();
    await store.enqueue('v-1', answers('NO', 50));
    await store.enqueue('v-1', answers('YES', 52.99));
    const view = (await store.visit('v-1'))!;
    expect(view.syncStatus).toBe('LOCAL');
    expect(view.ops.map((o) => o.kind)).toEqual(['start', 'answers']);
    expect(view.visit.readings).toMatchObject([{ readingFieldId: 'f-volt', numericValue: 52.99 }]);
    expect(view.visit.failureCount).toBe(0);
    expect(await store.counts()).toEqual({ pending: 2, syncing: 0, errors: 0 });
    const other = new OfflineStore(db, 'u-2');
    expect(await other.visits()).toEqual([]);
    expect(await other.ops()).toEqual([]);
    expect((await store.visits()).length).toBe(1);
  });

  it('a photo removed before it was sent is dropped with its file', async () => {
    await startOffline();
    await store.enqueue('v-1', { kind: 'photo', payload: { id: 'p-1', localUri: 'file:///p-1.jpg', checklistItemId: 'i-clean', takenAt: T0 } });
    expect(await store.enqueue('v-1', { kind: 'photo_delete', payload: { photoId: 'p-1' } })).toEqual({ unusedFiles: ['file:///p-1.jpg'] });
    expect((await store.visit('v-1'))!.visit.photos).toEqual([]);
    expect((await store.ops('v-1')).map((o) => o.kind)).toEqual(['start']);
  });
});

describe('sync', () => {
  it('sends a whole offline PM in order and ends with the server’s copy', async () => {
    await startOffline();
    await store.enqueue('v-1', answers('YES', 52.99));
    await store.enqueue('v-1', { kind: 'battery', payload: { units: [1, 2].map((n) => ({ unitNumber: n, voltageV: 13, clientUpdatedAt: T0 })) } });
    await store.enqueue('v-1', { kind: 'photo', payload: { id: 'p-1', localUri: 'file:///p-1.jpg', checklistItemId: 'i-clean', takenAt: T0 } });
    await store.enqueue('v-1', { kind: 'sign', payload: { width: 100, height: 100, strokes: [[[1, 1], [2, 2]]] } });
    const local = (await store.visit('v-1'))!.visit;
    expect(local.issues).toEqual([]);
    await store.enqueue('v-1', { kind: 'complete', payload: {} });

    expect(await engine.sync()).toEqual({ sent: 6, refused: 0, offline: false });
    expect(api.calls).toEqual([
      'POST /visits',
      'PUT /visits/v-1/answers',
      'PUT /visits/v-1/battery-units',
      'POST /visits/v-1/photos',
      'GET /visits/v-1',
      'PUT /visits/v-1/signature',
      'POST /visits/v-1/complete',
    ]);
    expect(deleted).toEqual(['file:///p-1.jpg']);
    const view = (await store.visit('v-1'))!;
    expect(view).toMatchObject({ syncStatus: 'SYNCED', fromServer: true, visit: { status: 'COMPLETED', completionPct: 100 } });
    expect(view.visit.photos[0]!.localUri).toBeUndefined();
  });

  it('without a connection keeps everything and retries with back-off', async () => {
    await startOffline();
    await store.enqueue('v-1', answers('YES', 52.99));
    api.offline = true;
    expect(await engine.sync()).toEqual({ sent: 0, refused: 0, offline: true });
    const [first] = await store.ops('v-1');
    expect(first).toMatchObject({ status: 'PENDING_SYNC', attempts: 1, nextAttemptAt: now + 5_000, lastError: 'No connection to the server.' });
    api.offline = false;
    expect((await engine.sync()).sent).toBe(0); // not due yet
    now += 5_000;
    expect((await engine.sync()).sent).toBe(2);
    expect((await store.visit('v-1'))!.syncStatus).toBe('SYNCED');
  });

  it('server errors are retried; a refusal waits for the technician (retry or discard)', async () => {
    await startOffline();
    api.failNext = [new ApiError(503, 'HTTP_503', 'Service unavailable')];
    expect((await engine.sync()).sent).toBe(0);
    now += 5_000;
    await engine.sync();
    await store.enqueue('v-1', answers('YES', 52.99));
    api.refuse = { path: /answers/, error: new ApiError(422, 'VALIDATION_FAILED', 'Some answers are not valid.', [{ path: 'readings.0', message: 'too high' }]) };
    expect(await engine.sync()).toEqual({ sent: 0, refused: 1, offline: false });
    const view = (await store.visit('v-1'))!;
    expect(view.syncStatus).toBe('SYNC_ERROR');
    expect(view.ops[0]).toMatchObject({ status: 'SYNC_ERROR', lastError: 'Some answers are not valid.', lastErrorDetails: [{ path: 'readings.0', message: 'too high' }] });
    expect(await store.counts()).toEqual({ pending: 0, syncing: 0, errors: 1 });

    api.refuse = null;
    await store.retry('v-1');
    expect((await engine.sync()).sent).toBe(1);
    expect((await store.visit('v-1'))!.syncStatus).toBe('SYNCED');
  });

  it('discarding the refused start of an offline visit removes the visit and its photos', async () => {
    await startOffline();
    await store.enqueue('v-1', { kind: 'photo', payload: { id: 'p-1', localUri: 'file:///p-1.jpg', checklistItemId: null, takenAt: T0 } });
    api.refuse = { path: /^POST \/visits$/, error: new ApiError(403, 'NOT_ASSIGNED', 'You are not assigned to this site.') };
    await engine.sync();
    const [start] = await store.ops('v-1');
    expect(start!.status).toBe('SYNC_ERROR');
    expect(await store.discard(start!.seq)).toEqual({ unusedFiles: ['file:///p-1.jpg'], visitRemoved: true });
    expect(await store.visit('v-1')).toBeNull();
    expect(await store.ops()).toEqual([]);
  });

  it('a change sent twice (answer lost) is harmless: completing an already completed visit succeeds', async () => {
    await startOffline();
    await store.enqueue('v-1', answers('YES', 52.99));
    await store.enqueue('v-1', { kind: 'battery', payload: { units: [1, 2].map((n) => ({ unitNumber: n, voltageV: 13, clientUpdatedAt: T0 })) } });
    await store.enqueue('v-1', { kind: 'sign', payload: { width: 100, height: 100, strokes: [[[1, 1], [2, 2]]] } });
    await engine.sync();
    await store.enqueue('v-1', { kind: 'complete', payload: {} });
    // The server completed it, but the phone never heard back.
    await api.request('/visits/v-1/complete', { method: 'POST' });
    expect(await engine.sync()).toMatchObject({ sent: 1, refused: 0 });
    expect((await store.visit('v-1'))!.visit.status).toBe('COMPLETED');
  });

  it('an app closed mid-send sends the change again', async () => {
    await startOffline();
    const [start] = await store.ops('v-1');
    await store.markSyncing(start!.seq);
    expect(await engine.sync()).toMatchObject({ sent: 1 });
  });

  it('downloads the field pack, keeps open visits and forgets finished ones', async () => {
    await startOffline();
    await engine.sync();
    await store.saveBase({ ...(await store.visit('v-1'))!.visit, id: 'old', status: 'APPROVED' }, true);
    const pack = await engine.refreshPack();
    expect(pack.visits.map((v) => v.id)).toEqual(['v-1']);
    expect((await store.getCache<typeof PACK>('pack'))!.data.sites[0]!.id).toBe(SITE.id);
    expect((await store.visits()).map((v) => v.visit.id)).toEqual(['v-1']);
  });

  it('queued changes stay on top of a newer server copy', async () => {
    await startOffline();
    await engine.sync();
    api.offline = true;
    await store.enqueue('v-1', answers('NO', 40));
    api.offline = false;
    api.visits.set('v-1', { ...api.visits.get('v-1')!, overallComments: 'from the server' });
    await engine.refreshVisit('v-1');
    const view = (await store.visit('v-1'))!;
    expect(view.visit).toMatchObject({ overallComments: 'from the server', failureCount: 1 });
    expect(view.syncStatus).toBe('PENDING_SYNC');
  });
});
