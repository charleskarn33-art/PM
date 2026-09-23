import { beforeEach, describe, expect, it } from 'vitest';
import { migrate } from './db';
import { LocalStore, opKeys, type VisitCreate } from './store';
import { backoffMs, SyncEngine, SyncError, type SyncTransport } from './sync';
import { NodeDb } from './testing/node-db';
import type { BundleVisit, LocalResponse, PhotoUploadPayload, SyncBundle, Visit } from './types';

const USER = 'tech-1';
const SITE = 'site-1';

/** In-memory server that records what it received and can be told to fail. */
class FakeServer implements SyncTransport {
  calls: string[] = [];
  visits = new Map<string, Record<string, unknown>>();
  responses = new Map<string, Record<string, unknown>>();
  readings = new Map<string, Record<string, unknown>>();
  photos = new Map<string, PhotoUploadPayload['row']>();
  offline = false;
  reject: ((kind: string, payload: Record<string, unknown>) => string | null) | null = null;
  /** Called while a request is "in flight" (to simulate edits during sync). */
  during: ((kind: string) => Promise<void>) | null = null;

  private async gate(kind: string, payload: Record<string, unknown>) {
    this.calls.push(kind);
    if (this.offline) throw new SyncError('network', 'Network request failed');
    const why = this.reject?.(kind, payload);
    if (why) throw new SyncError('rejected', why);
    await this.during?.(kind);
  }
  async createVisit(p: Record<string, unknown>) {
    await this.gate('visit.create', p);
    if (!this.visits.has(p.id as string)) this.visits.set(p.id as string, { ...p });
  }
  async updateVisit(id: string, patch: Record<string, unknown>) {
    await this.gate('visit.update', patch);
    const v = this.visits.get(id);
    if (!v) throw new SyncError('rejected', 'visit not found');
    Object.assign(v, patch);
  }
  async submitVisit(id: string, patch: Record<string, unknown>) {
    await this.gate('visit.submit', patch);
    const v = this.visits.get(id);
    if (!v) throw new SyncError('rejected', 'visit not found');
    Object.assign(v, patch);
  }
  async upsertResponse(p: Record<string, unknown>) {
    await this.gate('response', p);
    if (!this.visits.has(p.visit_id as string)) throw new SyncError('rejected', 'visit not found');
    this.responses.set(`${p.visit_id}:${p.checklist_item_id}`, { ...p });
  }
  async upsertReading(p: Record<string, unknown>) {
    await this.gate('reading', p);
    this.readings.set(`${p.visit_id}:${p.reading_field_id}`, { ...p });
  }
  async uploadPhoto(p: PhotoUploadPayload) {
    await this.gate('photo', p as unknown as Record<string, unknown>);
    this.photos.set(p.row.id, p.row);
  }
  async fetchBundle(): Promise<SyncBundle> {
    this.calls.push('bundle');
    if (this.offline) throw new SyncError('network', 'Network request failed');
    const visits: BundleVisit[] = [...this.visits.values()].map((v) => ({
      ...visitRow(v.id as string),
      ...(v as Partial<Visit>),
      completion_pct: 42,
      responses: [...this.responses.values()]
        .filter((r) => r.visit_id === v.id)
        .map((r) => ({ ...r, is_failure: r.answer === 'NO' }) as never),
      readings: [...this.readings.values()].filter((r) => r.visit_id === v.id) as never[],
      photos: [...this.photos.values()]
        .filter((p) => p.visit_id === v.id)
        .map((p) => ({ ...p, created_at: p.taken_at }) as never),
    }));
    return {
      generated_at: '2026-09-23T12:00:00.000Z',
      sites: [{ id: SITE, site_code: 'S1', supervisor_id: 'sup-1', is_demo: false } as never],
      schedules: [],
      templates: [],
      visits,
      settings: { geofence: { radius_m: 100, mode: 'WARN' } },
      consistency_rules: [],
    };
  }
}

function visitRow(id: string): Visit {
  return {
    id,
    schedule_id: null,
    site_id: SITE,
    template_id: 'tpl-1',
    technician_id: USER,
    supervisor_id: 'sup-1',
    status: 'IN_PROGRESS',
    started_at: '2026-09-23T08:00:00.000Z',
    ended_at: null,
    submitted_at: null,
    gps_latitude: null,
    gps_longitude: null,
    gps_accuracy_m: null,
    gps_captured_at: null,
    gps_distance_m: null,
    gps_radius_m: 100,
    gps_status: 'UNAVAILABLE',
    geofence_mode: 'WARN',
    outside_radius_reason: null,
    completion_pct: 0,
    failure_count: 0,
    not_applicable_sections: [],
    overall_comments: null,
    is_demo: false,
    technician_signature_path: null,
    technician_signed_at: null,
    reviewed_by: null,
    reviewed_at: null,
    review_comments: null,
    device_id: null,
    client_created_at: null,
    client_updated_at: null,
    created_at: '2026-09-23T08:00:00.000Z',
    updated_at: '2026-09-23T08:00:00.000Z',
    created_by: USER,
    updated_by: USER,
  };
}

const create = (id: string): VisitCreate => ({
  id,
  site_id: SITE,
  template_id: 'tpl-1',
  technician_id: USER,
  schedule_id: null,
  started_at: '2026-09-23T08:00:00.000Z',
  gps_latitude: 7,
  gps_longitude: -11,
  gps_accuracy_m: 5,
  gps_captured_at: '2026-09-23T08:00:00.000Z',
  outside_radius_reason: null,
  device_id: null,
  client_created_at: '2026-09-23T08:00:00.000Z',
});
const GPS = { gps_distance_m: 0, gps_radius_m: 100, gps_status: 'WITHIN_RADIUS', geofence_mode: 'WARN' } as const;

const answer = (itemId: string, value: 'YES' | 'NO', comment: string | null = null): LocalResponse => ({
  checklist_item_id: itemId,
  answer: value,
  numeric_value: null,
  text_value: null,
  selected_options: null,
  date_value: null,
  datetime_value: null,
  comment,
});

const photo = (id: string, visitId: string): PhotoUploadPayload => ({
  row: {
    id,
    site_id: SITE,
    visit_id: visitId,
    section_id: null,
    checklist_item_id: 'item-1',
    bucket: 'pm-photos',
    file_path: `${SITE}/${visitId}/${id}.jpg`,
    thumbnail_path: `${SITE}/${visitId}/${id}_thumb.jpg`,
    mime_type: 'image/jpeg',
    size_bytes: 1000,
    width: 1600,
    height: 1200,
    latitude: null,
    longitude: null,
    taken_at: '2026-09-23T09:00:00.000Z',
  },
  local_uri: `file:///docs/${id}.jpg`,
  thumb_uri: `file:///docs/${id}_thumb.jpg`,
});

let db: NodeDb;
let store: LocalStore;
let server: FakeServer;
let clock: number;
let engine: SyncEngine;

beforeEach(async () => {
  db = new NodeDb();
  await migrate(db);
  store = new LocalStore(db);
  server = new FakeServer();
  clock = Date.parse('2026-09-23T10:00:00.000Z');
  engine = new SyncEngine(store, server, USER, () => clock);
});

describe('local schema', () => {
  it('migrates once and is idempotent', async () => {
    await migrate(db);
    expect((await db.first<{ user_version: number }>('pragma user_version'))?.user_version).toBe(1);
  });
});

describe('LocalStore', () => {
  it('keeps work on the phone and coalesces repeated edits into one queued change', async () => {
    await store.createVisit(create('v1'), GPS);
    await store.saveResponse('v1', answer('item-1', 'YES'));
    await store.saveResponse('v1', answer('item-1', 'NO', 'burnt fuse'));
    await store.updateVisit('v1', { overall_comments: 'first' });
    await store.updateVisit('v1', { not_applicable_sections: ['SOLAR'] });

    const ops = await store.ops();
    expect(ops.map((o) => o.key)).toEqual([opKeys.visitCreate('v1'), opKeys.response('v1', 'item-1'), opKeys.visitUpdate('v1')]);
    expect(ops[1]!.version).toBe(2);
    expect(ops[1]!.payload).toMatchObject({ answer: 'NO', comment: 'burnt fuse' });
    // Partial visit updates merge rather than overwrite each other.
    expect(ops[2]!.payload).toMatchObject({ overall_comments: 'first', not_applicable_sections: ['SOLAR'] });

    const data = (await store.visitData('v1'))!;
    expect(data.visit).toMatchObject({ status: 'IN_PROGRESS', overall_comments: 'first', supervisor_id: null });
    expect(data.responses).toEqual([expect.objectContaining({ answer: 'NO', comment: 'burnt fuse' })]);
    expect(data.pendingKeys.has(opKeys.response('v1', 'item-1'))).toBe(true);
  });

  it('queues submission after every answer, even answers first edited before an earlier submit', async () => {
    await store.createVisit(create('v1'), GPS);
    await store.saveResponse('v1', answer('item-1', 'YES'));
    await store.submitVisit('v1');
    // Rejected-and-resubmitted style sequence: another edit then submit again.
    await store.saveResponse('v1', answer('item-2', 'YES'));
    await store.submitVisit('v1');
    const kinds = (await store.ops()).map((o) => o.kind);
    expect(kinds).toEqual(['visit.create', 'response.upsert', 'response.upsert', 'visit.submit']);
    expect((await store.visit('v1'))!.status).toBe('SUBMITTED');
  });

  it('removes an unsent photo but refuses to remove uploaded evidence', async () => {
    await store.createVisit(create('v1'), GPS);
    await store.addPhoto(photo('p1', 'v1'));
    expect((await store.photos('v1'))[0]).toMatchObject({ id: 'p1', pending: true, local_uri: 'file:///docs/p1.jpg' });
    expect(await store.removeUnsentPhoto('p1')).toEqual(['file:///docs/p1.jpg', 'file:///docs/p1_thumb.jpg']);
    expect(await store.photos('v1')).toEqual([]);

    await store.addPhoto(photo('p2', 'v1'));
    await engine.run();
    await expect(store.removeUnsentPhoto('p2')).rejects.toThrow(/already uploaded/);
  });
});

describe('SyncEngine', () => {
  it('sends changes in order, empties the outbox and downloads the server copy', async () => {
    await store.createVisit(create('v1'), GPS);
    await store.saveResponse('v1', answer('item-1', 'NO', 'burnt fuse'));
    await store.saveReading('v1', { reading_field_id: 'f1', numeric_value: 53.5, text_value: null });
    await store.addPhoto(photo('p1', 'v1'));
    await store.submitVisit('v1');

    const r = await engine.run();
    expect(r).toMatchObject({ sent: 5, rejected: 0, offline: false, downloaded: true, error: null });
    expect(server.calls).toEqual(['visit.create', 'response', 'reading', 'photo', 'visit.submit', 'bundle']);
    expect(await store.ops()).toEqual([]);
    expect(server.visits.get('v1')).toMatchObject({ status: 'SUBMITTED' });

    const data = (await store.visitData('v1'))!;
    expect(data.visit.completion_pct).toBe(42); // server-computed value arrives
    expect(data.responses[0]).toMatchObject({ answer: 'NO', is_failure: true });
    // The uploaded photo keeps its file on the phone for display.
    expect(data.photos[0]).toMatchObject({ id: 'p1', pending: false, local_uri: 'file:///docs/p1.jpg' });
    expect(await store.lastSyncedAt()).toBe('2026-09-23T12:00:00.000Z');
  });

  it('keeps everything and backs off when the network is down', async () => {
    await store.createVisit(create('v1'), GPS);
    await store.saveResponse('v1', answer('item-1', 'YES'));
    server.offline = true;

    const r = await engine.run();
    expect(r).toMatchObject({ sent: 0, offline: true, downloaded: false });
    expect(server.calls).toEqual(['visit.create']); // stopped at the first network failure
    const [first] = await store.ops();
    expect(first).toMatchObject({ state: 'PENDING', attempts: 1, last_error: 'Network request failed' });
    expect(first!.next_attempt_at).toBe(new Date(clock + backoffMs(0)).toISOString());

    // Inside the back-off window nothing is attempted (unless forced).
    server.offline = false;
    server.calls = [];
    await engine.run({ download: false });
    expect(server.calls).toEqual([]);
    clock += backoffMs(0) + 1;
    expect(await engine.run()).toMatchObject({ sent: 2, offline: false });
    expect(await store.ops()).toEqual([]);
  });

  it('backs off exponentially up to ten minutes', () => {
    expect([0, 1, 2, 3].map(backoffMs)).toEqual([5_000, 10_000, 20_000, 40_000]);
    expect(backoffMs(20)).toBe(600_000);
  });

  it('holds a visit’s later changes when the server refuses one, without blocking other visits', async () => {
    await store.createVisit(create('v1'), GPS);
    await store.saveResponse('v1', answer('item-1', 'YES'));
    await store.createVisit(create('v2'), GPS);
    await store.saveResponse('v2', answer('item-1', 'YES'));
    server.reject = (kind, p) =>
      kind === 'visit.create' && p.id === 'v1' ? 'Technician is outside the configured site radius. PM cannot be started here.' : null;

    const r = await engine.run();
    expect(r).toMatchObject({ sent: 2, rejected: 1, downloaded: true });
    expect(server.calls).toEqual(['visit.create', 'visit.create', 'response', 'bundle']);
    expect([...server.responses.keys()]).toEqual(['v2:item-1']);

    const summary = await store.summary();
    expect(summary.pending).toBe(2);
    expect(summary.errors).toEqual([expect.objectContaining({ key: opKeys.visitCreate('v1'), state: 'ERROR' })]);
    // The rejected visit is still on the phone (pending) after the download.
    expect((await store.visitData('v1'))!.errors).toHaveLength(1);

    // Refused ops are not retried automatically …
    server.calls = [];
    await engine.run({ download: false });
    expect(server.calls).toEqual([]);
    // … but can be retried once the cause is fixed, or discarded.
    server.reject = null;
    await store.retry('v1');
    expect(await engine.run()).toMatchObject({ sent: 2, rejected: 0 });
    expect(await store.ops()).toEqual([]);
  });

  it('a refused submission can be withdrawn without losing answers', async () => {
    await store.createVisit(create('v1'), GPS);
    await store.saveResponse('v1', answer('item-1', 'YES'));
    await store.submitVisit('v1');
    server.reject = (kind) => (kind === 'visit.submit' ? 'PM cannot be submitted: 3 required item(s) incomplete' : null);
    await engine.run({ download: false });
    // An answer made after the refused submit waits behind it.
    await store.saveResponse('v1', answer('item-2', 'YES'));
    await engine.run({ download: false });
    expect(server.responses.has('v1:item-2')).toBe(false);

    await store.withdrawSubmission('v1');
    expect((await store.visit('v1'))!.status).toBe('IN_PROGRESS');
    server.reject = null;
    await engine.run({ download: false });
    expect(server.responses.has('v1:item-2')).toBe(true);
    expect(server.visits.get('v1')!.status).toBe('IN_PROGRESS');
    // The phone-only field is never sent.
    await store.submitVisit('v1');
    await engine.run({ download: false });
    expect(server.visits.get('v1')).not.toHaveProperty('previous_status');
  });

  it('discarding a never-sent visit removes it and its photo files from the phone', async () => {
    await store.createVisit(create('v1'), GPS);
    await store.addPhoto(photo('p1', 'v1'));
    expect(await store.discardVisitChanges('v1')).toEqual(['file:///docs/p1.jpg', 'file:///docs/p1_thumb.jpg']);
    expect(await store.visit('v1')).toBeNull();
    expect(await store.ops()).toEqual([]);
  });

  it('does not lose an edit made while the previous version was being sent', async () => {
    await store.createVisit(create('v1'), GPS);
    await engine.run();
    await store.saveResponse('v1', answer('item-1', 'YES'));
    server.during = async (kind) => {
      if (kind !== 'response') return;
      server.during = null;
      await store.saveResponse('v1', answer('item-1', 'NO', 'changed mid-sync'));
    };

    await engine.run({ download: false });
    // The first send finished, but the newer edit is still queued (version changed).
    const ops = await store.ops();
    expect(ops).toEqual([expect.objectContaining({ key: opKeys.response('v1', 'item-1'), state: 'PENDING', version: 2 })]);
    await engine.run();
    expect(server.responses.get('v1:item-1')).toMatchObject({ answer: 'NO', comment: 'changed mid-sync' });
    expect((await store.visitData('v1'))!.responses[0]).toMatchObject({ answer: 'NO' });
  });

  it('download never overwrites answers that are still waiting to be sent', async () => {
    await store.createVisit(create('v1'), GPS);
    await store.saveResponse('v1', answer('item-1', 'YES'));
    await store.updateVisit('v1', { overall_comments: 'on site' });
    await engine.run();
    server.visits.get('v1')!.review_comments = 'looks fine';

    // Offline edits, then a download (e.g. a pull triggered before the push succeeded).
    await store.saveResponse('v1', answer('item-1', 'NO', 'local edit'));
    await store.updateVisit('v1', { overall_comments: 'local comment' });
    await store.applyBundle(await server.fetchBundle(), USER);

    const data = (await store.visitData('v1'))!;
    expect(data.responses[0]).toMatchObject({ answer: 'NO', comment: 'local edit' });
    expect(data.visit.overall_comments).toBe('local comment');
    expect(data.visit.review_comments).toBe('looks fine'); // server-owned fields still update
  });

  it('removes visits that left the technician’s list, with their photo files, unless work is unsent', async () => {
    await store.createVisit(create('v1'), GPS);
    await store.addPhoto(photo('p1', 'v1'));
    await engine.run();
    await store.createVisit(create('v2'), GPS); // not yet sent

    server.visits.delete('v1'); // e.g. approved
    server.photos.delete('p1');
    const { removedFiles } = await store.applyBundle(await server.fetchBundle(), USER);
    expect(removedFiles).toEqual(['file:///docs/p1.jpg', 'file:///docs/p1_thumb.jpg']);
    expect(await store.visit('v1')).toBeNull();
    expect(await store.visit('v2')).not.toBeNull();
  });

  it('never sends one account’s unsent work as another account', async () => {
    await store.createVisit(create('v1'), GPS);
    server.offline = true;
    await engine.run();
    await store.applyBundle({ ...(await new FakeServer().fetchBundle()) }, USER);

    const other = new SyncEngine(store, server, 'tech-2', () => clock);
    server.offline = false;
    server.calls = [];
    const r = await other.run({ force: true });
    expect(r.error).toMatch(/another account/);
    expect(server.calls).toEqual([]);
    expect((await store.clearForSignOut()).cleared).toBe(false);
  });

  it('clears the phone on sign-out when nothing is waiting', async () => {
    await store.createVisit(create('v1'), GPS);
    await store.addPhoto(photo('p1', 'v1'));
    await engine.run();
    expect(await store.clearForSignOut()).toEqual({ cleared: true, removedFiles: ['file:///docs/p1.jpg', 'file:///docs/p1_thumb.jpg'] });
    expect(await store.visits()).toEqual([]);
    expect(await store.ownerId()).toBeNull();
  });

  it('runs one sync at a time', async () => {
    await store.createVisit(create('v1'), GPS);
    const [a, b] = await Promise.all([engine.run(), engine.run()]);
    expect(a).toBe(b);
    expect(server.calls.filter((c) => c === 'visit.create')).toHaveLength(1);
  });
});
