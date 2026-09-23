/**
 * End-to-end offline sync: the phone's real LocalStore + SyncEngine +
 * Supabase transport (apps/mobile/src/offline) against the real PostgREST and
 * database, with RLS, guards and triggers. Only Storage is simulated (the
 * Storage API server is not available locally): an upload inserts the
 * storage.objects row as the signed-in user, so storage RLS still applies.
 *
 * This test commits real rows, so it works only with its own region C
 * fixtures (tech.c / S-C1) and removes what it created afterwards.
 */
import { randomUUID } from 'node:crypto';
import { visitIssues, type ChecklistState, type Database } from '@ipt/shared';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../../../apps/mobile/src/offline/db';
import { LocalStore, opKeys, type VisitCreate } from '../../../apps/mobile/src/offline/store';
import { supabaseTransport } from '../../../apps/mobile/src/offline/supabase-transport';
import { SyncEngine } from '../../../apps/mobile/src/offline/sync';
import { NodeDb } from '../../../apps/mobile/src/offline/testing/node-db';
import { photoPaths, type BundleTemplate, type LocalResponse } from '../../../apps/mobile/src/offline/types';
import { actAs, getPool, ids } from './db';
import { PGRST_URL, postgrestBinary, signJwt } from './postgrest';

const API = 'http://api.test';
const USER = ids.techC;
const SITE = ids.siteC1;

/** Routes supabase-js to the local PostgREST; simulates Storage uploads (see above). */
function makeFetch(userId: string, state: { offline: boolean }): typeof fetch {
  return async (input, init) => {
    if (state.offline) throw new TypeError('Network request failed');
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.pathname.startsWith('/rest/v1/')) {
      return fetch(`${PGRST_URL}${url.pathname.slice('/rest/v1'.length)}${url.search}`, init);
    }
    const upload = url.pathname.match(/^\/storage\/v1\/object\/([^/]+)\/(.+)$/);
    if (upload && init?.method === 'POST') {
      const [, bucket, path] = upload;
      const client = await getPool().connect();
      try {
        await client.query('begin');
        await actAs(client, userId);
        const exists = await client.query('select 1 from storage.objects where bucket_id = $1 and name = $2', [bucket, decodeURIComponent(path!)]);
        if (!exists.rowCount) {
          await client.query('insert into storage.objects (bucket_id, name, owner_id) values ($1, $2, $3)', [bucket, decodeURIComponent(path!), userId]);
        }
        await client.query('commit');
        return Response.json({ Id: randomUUID(), Key: `${bucket}/${path}` });
      } catch (e) {
        await client.query('rollback');
        return Response.json({ statusCode: '403', error: 'Unauthorized', message: (e as Error).message }, { status: 403 });
      } finally {
        client.release();
      }
    }
    return new Response('not found', { status: 404 });
  };
}

function phone(userId: string) {
  const net = { offline: false };
  const db = new NodeDb();
  const store = new LocalStore(db);
  const token = signJwt(userId);
  const client = createClient<Database>(API, token, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: makeFetch(userId, net), headers: { Authorization: `Bearer ${token}` } },
  });
  const photoBytes = async () => new TextEncoder().encode('fake-jpeg').buffer as ArrayBuffer;
  const engine = new SyncEngine(store, supabaseTransport(client, photoBytes), userId);
  return { db, store, engine, net };
}

const createInput = (id: string, templateId: string, lat = 8.0, lng = -12.0): VisitCreate => ({
  id,
  site_id: SITE,
  template_id: templateId,
  technician_id: USER,
  schedule_id: null,
  started_at: new Date().toISOString(),
  gps_latitude: lat,
  gps_longitude: lng,
  gps_accuracy_m: 5,
  gps_captured_at: new Date().toISOString(),
  outside_radius_reason: null,
  device_id: 'test-phone',
  client_created_at: new Date().toISOString(),
});
const LOCAL_GPS = { gps_distance_m: 0, gps_radius_m: 100, gps_status: 'WITHIN_RADIUS', geofence_mode: 'WARN' } as const;

const blank = (itemId: string): LocalResponse => ({
  checklist_item_id: itemId,
  answer: null,
  numeric_value: null,
  text_value: null,
  selected_options: null,
  date_value: null,
  datetime_value: null,
  comment: null,
});

async function addPhoto(store: LocalStore, visitId: string, sectionId: string, itemId: string) {
  const photoId = randomUUID();
  const paths = photoPaths(SITE, visitId, photoId);
  await store.addPhoto({
    row: {
      id: photoId, site_id: SITE, visit_id: visitId, section_id: sectionId, checklist_item_id: itemId,
      bucket: 'pm-photos', file_path: paths.file, thumbnail_path: paths.thumb, mime_type: 'image/jpeg',
      size_bytes: 9, width: 1600, height: 1200, latitude: null, longitude: null, taken_at: new Date().toISOString(),
    },
    local_uri: `file:///test/${photoId}.jpg`,
    thumb_uri: `file:///test/${photoId}_thumb.jpg`,
  });
}

/** Answers the whole checklist on the phone the way a technician would, using the shared rules to find what is missing. */
async function completeChecklist(store: LocalStore, visitId: string, template: BundleTemplate) {
  const items = template.sections.flatMap((s) => s.items).filter((i) => i.is_active);
  const fields = template.sections.flatMap((s) => s.fields).filter((f) => f.is_active);
  const today = new Date().toISOString().slice(0, 10);
  for (const i of items) {
    const r = blank(i.id);
    const opts = (i.options as string[] | null) ?? [];
    switch (i.response_type) {
      case 'YES_NO_NA': r.answer = 'YES'; break;
      case 'NUMBER': r.numeric_value = i.min_value ?? 1; break;
      case 'SELECT': r.text_value = opts[0] ?? null; break;
      case 'MULTI_SELECT': r.selected_options = opts.slice(0, 1); break;
      case 'DATE': r.date_value = today; break;
      case 'DATETIME': r.datetime_value = new Date().toISOString(); break;
      case 'PHOTO': continue;
      default: r.text_value = 'OK';
    }
    await store.saveResponse(visitId, r);
  }
  for (const f of fields) {
    const opts = (f.options as string[] | null) ?? [];
    await store.saveReading(visitId, {
      reading_field_id: f.id,
      numeric_value: f.value_type === 'NUMBER' ? (f.min_value ?? 1) : null,
      text_value: f.value_type === 'SELECT' ? (opts[0] ?? null) : f.value_type === 'NUMBER' ? null : 'OK',
    });
  }
  // Follow-ups the rules ask for: comments and photos.
  for (let round = 0; round < 3; round += 1) {
    const data = (await store.visitData(visitId))!;
    const [settings, rules] = await Promise.all([store.settings(), store.consistencyRules()]);
    const counts: Record<string, number> = {};
    for (const p of data.photos) if (p.checklist_item_id) counts[p.checklist_item_id] = (counts[p.checklist_item_id] ?? 0) + 1;
    const state: ChecklistState = {
      sections: template.sections,
      items,
      readingFields: fields,
      responses: data.responses,
      readings: data.readings,
      photoCounts: counts,
      notApplicableSections: data.visit.not_applicable_sections,
      enforcePhotoRequirements: settings.pm_submission?.enforce_photo_requirements ?? true,
      consistencyRules: rules,
    };
    const issues = visitIssues(state);
    if (issues.length === 0) return;
    for (const issue of issues) {
      if (issue.issue === 'COMMENT_REQUIRED') {
        const r = data.responses.find((x) => x.checklist_item_id === issue.refId) ?? blank(issue.refId);
        await store.saveResponse(visitId, { ...r, comment: 'Checked and recorded.' });
      } else if (issue.issue === 'PHOTO_REQUIRED') {
        const item = items.find((i) => i.id === issue.refId)!;
        await addPhoto(store, visitId, item.section_id, item.id);
      } else {
        throw new Error(`Test cannot resolve issue ${issue.issue} for ${issue.label}`);
      }
    }
  }
}

const created: string[] = [];

describe.skipIf(!postgrestBinary())('mobile offline sync end to end (real API)', () => {
  let template: BundleTemplate;

  beforeAll(async () => {
    const { store, db, engine } = phone(USER);
    await migrate(db);
    const r = await engine.run();
    expect(r.error).toBeNull();
    const active = (await store.templates()).find((t) => t.status === 'ACTIVE');
    template = active!;
  });

  afterAll(async () => {
    if (!created.length) return;
    const c = await getPool().connect();
    try {
      await c.query('begin');
      await actAs(c, null);
      await c.query(`select set_config('ipt.system_update', 'on', true)`);
      await c.query('delete from public.pm_photos where visit_id = any($1::uuid[])', [created]);
      await c.query('delete from public.pm_responses where visit_id = any($1::uuid[])', [created]);
      await c.query('delete from public.pm_readings where visit_id = any($1::uuid[])', [created]);
      await c.query('delete from public.corrective_actions where visit_id = any($1::uuid[])', [created]);
      await c.query('delete from public.failures where visit_id = any($1::uuid[])', [created]);
      await c.query('delete from public.notifications where entity_id = any($1::uuid[])', [created]);
      await c.query('delete from public.pm_visits where id = any($1::uuid[])', [created]);
      await c.query(`delete from storage.objects where name like $1`, [`${SITE}/%`]);
      await c.query('commit');
    } finally {
      c.release();
    }
  });

  it('downloads only the technician’s own scope', async () => {
    const { store, db, engine } = phone(USER);
    await migrate(db);
    await engine.run();
    expect((await store.sites()).map((s) => s.site_code)).toEqual(['S-C1']);
    expect((await store.site(SITE))?.region_name).toBe('Region C');
    expect(template.sections.length).toBeGreaterThan(0);
  });

  it('works offline, then sends everything in order and the server accepts the submitted PM', async () => {
    const { store, db, engine, net } = phone(USER);
    await migrate(db);
    await engine.run();

    // No connection: the whole PM is done on the phone.
    net.offline = true;
    const visitId = randomUUID();
    created.push(visitId);
    await store.createVisit(createInput(visitId, template.id), LOCAL_GPS);
    const firstItem = template.sections[0]!.items[0]!;
    await addPhoto(store, visitId, firstItem.section_id, firstItem.id); // an extra (optional) evidence photo
    await completeChecklist(store, visitId, template);
    await store.updateVisit(visitId, { overall_comments: 'Completed offline.' });
    await store.submitVisit(visitId);
    const offline = await engine.run();
    expect(offline).toMatchObject({ offline: true, sent: 0 });
    const queued = (await store.ops()).length;
    expect(queued).toBeGreaterThan(10);

    // Back online: everything is sent, the server accepts the submission.
    net.offline = false;
    const r = await engine.run({ force: true });
    expect(r).toMatchObject({ sent: queued, rejected: 0, offline: false, downloaded: true, error: null });
    expect(await store.ops()).toEqual([]);

    const c = await getPool().connect();
    try {
      const v = await c.query('select status, gps_status, gps_distance_m, completion_pct, overall_comments, device_id from public.pm_visits where id = $1', [visitId]);
      expect(v.rows[0]).toMatchObject({ status: 'SUBMITTED', gps_status: 'WITHIN_RADIUS', overall_comments: 'Completed offline.', device_id: 'test-phone' });
      expect(Number(v.rows[0].completion_pct)).toBe(100);
      const photos = await c.query('select count(*)::int as n from public.pm_photos where visit_id = $1', [visitId]);
      const local = (await store.visitData(visitId))!;
      expect(photos.rows[0].n).toBe(local.photos.length);
      expect(photos.rows[0].n).toBeGreaterThanOrEqual(1);
      // File and thumbnail are in storage for every photo row.
      const objects = await c.query('select count(*)::int as n from storage.objects where name like $1', [`${SITE}/${visitId}/%`]);
      expect(objects.rows[0].n).toBe(2 * photos.rows[0].n);
      expect(local.visit.status).toBe('SUBMITTED');
      expect(local.photos.every((p) => !p.pending)).toBe(true);
    } finally {
      c.release();
    }

    // Re-sending after an app kill is harmless (every operation is idempotent).
    const again = phone(USER);
    await migrate(again.db);
    await again.engine.run();
    expect((await again.store.visit(visitId))?.status).toBe('SUBMITTED');
  });

  it('the server’s refusal is kept for the technician and holds that PM’s later changes', async () => {
    const { store, db, engine } = phone(USER);
    await migrate(db);
    await engine.run();
    const visitId = randomUUID();
    created.push(visitId);
    await store.createVisit(createInput(visitId, template.id), LOCAL_GPS);
    const first = template.sections[0]!.items.find((i) => i.response_type === 'YES_NO_NA')!;
    await store.saveResponse(visitId, { ...blank(first.id), answer: 'YES' });
    await store.submitVisit(visitId); // incomplete: the server must refuse it

    const r = await engine.run();
    expect(r).toMatchObject({ rejected: 1, downloaded: true });
    const [op] = await store.ops();
    expect(op).toMatchObject({ key: opKeys.visitSubmit(visitId), state: 'ERROR' });
    expect(op!.last_error).toMatch(/required|incomplete|cannot be submitted/i);
    // The download kept the local (submitted) state because the change is unsent.
    expect((await store.visit(visitId))?.status).toBe('SUBMITTED');

    // Withdraw, keep working, and the rest goes through.
    await store.withdrawSubmission(visitId);
    const second = template.sections[0]!.items.filter((i) => i.response_type === 'YES_NO_NA')[1]!;
    await store.saveResponse(visitId, { ...blank(second.id), answer: 'YES' });
    const r2 = await engine.run();
    expect(r2).toMatchObject({ rejected: 0, error: null });
    expect(await store.ops()).toEqual([]);
    expect((await store.visit(visitId))?.status).toBe('IN_PROGRESS');
    expect((await store.visitData(visitId))!.responses).toHaveLength(2);
  });

  it('another technician’s phone cannot write into this PM (RLS refusal is not retried)', async () => {
    const { store, db, engine } = phone(ids.techA);
    await migrate(db);
    await engine.run();
    const visitId = randomUUID();
    await store.createVisit({ ...createInput(visitId, template.id), technician_id: ids.techA }, LOCAL_GPS);
    const r = await engine.run();
    expect(r.rejected).toBe(1);
    expect((await store.ops())[0]).toMatchObject({ state: 'ERROR' });
  });
});
