import type { ConsistencyRule } from '@ipt/shared';
import type { LocalDb, SqlParam } from './db';
import type {
  BundleSettings,
  BundleTemplate,
  LocalPhoto,
  LocalReading,
  LocalResponse,
  OpKind,
  OutboxOp,
  PhotoUploadPayload,
  Schedule,
  Site,
  SyncBundle,
  Visit,
} from './types';

/** Visit columns the technician edits on the phone; everything else is the server's. */
const CLIENT_VISIT_FIELDS = ['not_applicable_sections', 'overall_comments', 'status', 'ended_at'] as const;
type ClientVisitPatch = Partial<Pick<Visit, (typeof CLIENT_VISIT_FIELDS)[number]>>;

/** What the phone sends to create a visit (the server computes GPS status, supervisor, progress). */
export type VisitCreate = Pick<
  Visit,
  | 'id'
  | 'site_id'
  | 'template_id'
  | 'technician_id'
  | 'schedule_id'
  | 'started_at'
  | 'gps_latitude'
  | 'gps_longitude'
  | 'gps_accuracy_m'
  | 'gps_captured_at'
  | 'outside_radius_reason'
  | 'device_id'
  | 'client_created_at'
>;

/** Local estimate of the server's GPS evaluation, shown until the server's own values arrive. */
export type LocalGps = Pick<Visit, 'gps_distance_m' | 'gps_radius_m' | 'gps_status' | 'geofence_mode'>;

export interface VisitData {
  visit: Visit;
  responses: LocalResponse[];
  readings: LocalReading[];
  photos: LocalPhoto[];
  /** Outbox keys still waiting to be sent for this visit. */
  pendingKeys: Set<string>;
  /** Server rejections for this visit (they stop its later changes from being sent). */
  errors: OutboxOp[];
}

export interface OutboxSummary {
  pending: number;
  errors: OutboxOp[];
  nextAttemptAt: string | null;
}

interface OpRow {
  seq: number;
  key: string;
  kind: OpKind;
  visit_id: string;
  payload: string;
  state: OutboxOp['state'];
  version: number;
  attempts: number;
  last_error: string | null;
  next_attempt_at: string | null;
  created_at: string;
  updated_at: string;
}

interface PhotoRow {
  id: string;
  visit_id: string;
  item_id: string | null;
  local_uri: string | null;
  thumb_uri: string | null;
  json: string;
}

export const opKeys = {
  visitCreate: (visitId: string) => `visit.create:${visitId}`,
  visitUpdate: (visitId: string) => `visit.update:${visitId}`,
  visitSubmit: (visitId: string) => `visit.submit:${visitId}`,
  response: (visitId: string, itemId: string) => `response:${visitId}:${itemId}`,
  reading: (visitId: string, fieldId: string) => `reading:${visitId}:${fieldId}`,
  photo: (photoId: string) => `photo:${photoId}`,
};

const toOp = (r: OpRow): OutboxOp => ({ ...r, payload: JSON.parse(r.payload) as Record<string, unknown> });

/**
 * The phone's offline copy of the technician's work plus the outbox of changes
 * still to send. Every edit is written locally first (so nothing is lost when
 * the app closes or the network drops) together with an outbox operation.
 * Repeated edits of the same thing coalesce into one operation.
 */
export class LocalStore {
  constructor(
    private readonly db: LocalDb,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  // ---- documents -----------------------------------------------------------
  private async doc<T>(key: string): Promise<T | null> {
    const row = await this.db.first<{ json: string }>('select json from documents where key = ?', [key]);
    return row ? (JSON.parse(row.json) as T) : null;
  }
  private async setDoc(key: string, value: unknown) {
    await this.db.run(
      'insert into documents (key, json, updated_at) values (?, ?, ?) on conflict (key) do update set json = excluded.json, updated_at = excluded.updated_at',
      [key, JSON.stringify(value), this.now()],
    );
  }

  async ownerId(): Promise<string | null> {
    return (await this.doc<{ userId: string }>('owner'))?.userId ?? null;
  }
  async lastSyncedAt(): Promise<string | null> {
    return (await this.doc<{ at: string }>('last_sync'))?.at ?? null;
  }
  async hasData(): Promise<boolean> {
    return (await this.lastSyncedAt()) != null;
  }
  async sites(): Promise<Site[]> {
    return (await this.doc<Site[]>('sites')) ?? [];
  }
  async site(id: string): Promise<Site | null> {
    return (await this.sites()).find((s) => s.id === id) ?? null;
  }
  async schedules(): Promise<Schedule[]> {
    return (await this.doc<Schedule[]>('schedules')) ?? [];
  }
  async templates(): Promise<BundleTemplate[]> {
    return (await this.doc<BundleTemplate[]>('templates')) ?? [];
  }
  async template(id: string): Promise<BundleTemplate | null> {
    return (await this.templates()).find((t) => t.id === id) ?? null;
  }
  async settings(): Promise<BundleSettings> {
    return (await this.doc<BundleSettings>('settings')) ?? {};
  }
  async consistencyRules(): Promise<ConsistencyRule[]> {
    return (await this.doc<ConsistencyRule[]>('consistency_rules')) ?? [];
  }

  // ---- download ------------------------------------------------------------
  /**
   * Replaces the local copy with the server's, except for anything that still
   * has an unsent change (those stay as the technician left them). Returns
   * photo files on the phone that are no longer needed.
   */
  async applyBundle(bundle: SyncBundle, userId: string): Promise<{ removedFiles: string[] }> {
    const removedFiles: string[] = [];
    await this.db.transaction(async () => {
      const owner = await this.ownerId();
      if (owner && owner !== userId) {
        if ((await this.opCount()) > 0) throw new Error('This phone has unsent PM work from another account.');
        removedFiles.push(...(await this.wipe()));
      }
      await this.setDoc('owner', { userId });
      await this.setDoc('sites', bundle.sites);
      await this.setDoc('schedules', bundle.schedules);
      await this.setDoc('templates', bundle.templates);
      await this.setDoc('settings', bundle.settings);
      await this.setDoc('consistency_rules', bundle.consistency_rules);

      const pendingKeys = new Set((await this.db.all<{ key: string }>('select key from outbox')).map((r) => r.key));
      const pendingVisits = new Set(
        (await this.db.all<{ visit_id: string }>('select distinct visit_id from outbox')).map((r) => r.visit_id),
      );
      const serverIds = new Set(bundle.visits.map((v) => v.id));

      for (const sv of bundle.visits) {
        const { responses, readings, photos, ...server } = sv;
        const local = await this.visit(sv.id);
        const visitPending = [opKeys.visitUpdate(sv.id), opKeys.visitSubmit(sv.id)].some((k) => pendingKeys.has(k));
        const merged: Visit = { ...server };
        if (local && visitPending) for (const f of CLIENT_VISIT_FIELDS) Object.assign(merged, { [f]: local[f] });
        await this.putVisit(merged);

        await this.db.run(
          `delete from responses where visit_id = ? and not exists
             (select 1 from outbox o where o.key = 'response:' || responses.visit_id || ':' || responses.item_id)`,
          [sv.id],
        );
        for (const r of responses) {
          if (pendingKeys.has(opKeys.response(sv.id, r.checklist_item_id))) continue;
          await this.putResponse(sv.id, r);
        }
        await this.db.run(
          `delete from readings where visit_id = ? and not exists
             (select 1 from outbox o where o.key = 'reading:' || readings.visit_id || ':' || readings.field_id)`,
          [sv.id],
        );
        for (const r of readings) {
          if (pendingKeys.has(opKeys.reading(sv.id, r.reading_field_id))) continue;
          await this.putReading(sv.id, r);
        }

        const serverPhotoIds = new Set(photos.map((p) => p.id));
        for (const p of await this.photoRows(sv.id)) {
          if (serverPhotoIds.has(p.id) || pendingKeys.has(opKeys.photo(p.id))) continue;
          removedFiles.push(...[p.local_uri, p.thumb_uri].filter((u): u is string => !!u));
          await this.db.run('delete from photos where id = ?', [p.id]);
        }
        for (const p of photos) {
          await this.db.run(
            `insert into photos (id, visit_id, item_id, local_uri, thumb_uri, json, created_at) values (?, ?, ?, null, null, ?, ?)
             on conflict (id) do update set json = excluded.json`,
            [p.id, sv.id, p.checklist_item_id, JSON.stringify(serverPhoto(p)), p.created_at],
          );
        }
      }

      // Visits that left the technician's scope (approved, cancelled, reassigned).
      for (const { id } of await this.db.all<{ id: string }>('select id from visits')) {
        if (serverIds.has(id) || pendingVisits.has(id)) continue;
        removedFiles.push(...(await this.deleteVisitLocally(id)));
      }
      await this.setDoc('last_sync', { at: bundle.generated_at });
    });
    return { removedFiles };
  }

  // ---- visits --------------------------------------------------------------
  async visits(): Promise<Visit[]> {
    const rows = await this.db.all<{ json: string }>('select json from visits');
    return rows.map((r) => JSON.parse(r.json) as Visit);
  }
  async visit(id: string): Promise<Visit | null> {
    const row = await this.db.first<{ json: string }>('select json from visits where id = ?', [id]);
    return row ? (JSON.parse(row.json) as Visit) : null;
  }
  private async putVisit(v: Visit) {
    await this.db.run(
      'insert into visits (id, json, updated_at) values (?, ?, ?) on conflict (id) do update set json = excluded.json, updated_at = excluded.updated_at',
      [v.id, JSON.stringify(v), this.now()],
    );
  }

  async visitData(id: string): Promise<VisitData | null> {
    const visit = await this.visit(id);
    if (!visit) return null;
    const [responses, readings, photos, ops] = await Promise.all([
      this.db.all<{ json: string }>('select json from responses where visit_id = ?', [id]),
      this.db.all<{ json: string }>('select json from readings where visit_id = ?', [id]),
      this.photos(id),
      this.db.all<OpRow>('select * from outbox where visit_id = ? order by seq', [id]),
    ]);
    return {
      visit,
      responses: responses.map((r) => JSON.parse(r.json) as LocalResponse),
      readings: readings.map((r) => JSON.parse(r.json) as LocalReading),
      photos,
      pendingKeys: new Set(ops.map((o) => o.key)),
      errors: ops.filter((o) => o.state === 'ERROR').map(toOp),
    };
  }

  /** Starts a PM on the phone. The server re-checks GPS and structure when it arrives. */
  async createVisit(input: VisitCreate, gps: LocalGps): Promise<Visit> {
    const now = this.now();
    const visit: Visit = {
      ...input,
      ...gps,
      supervisor_id: (await this.site(input.site_id))?.supervisor_id ?? null,
      status: 'IN_PROGRESS',
      ended_at: null,
      submitted_at: null,
      completion_pct: 0,
      failure_count: 0,
      not_applicable_sections: [],
      overall_comments: null,
      is_demo: (await this.site(input.site_id))?.is_demo ?? false,
      technician_signature_path: null,
      technician_signed_at: null,
      reviewed_by: null,
      reviewed_at: null,
      review_comments: null,
      client_updated_at: now,
      created_at: now,
      updated_at: now,
      created_by: input.technician_id,
      updated_by: input.technician_id,
    };
    await this.db.transaction(async () => {
      await this.putVisit(visit);
      await this.enqueue(opKeys.visitCreate(input.id), 'visit.create', input.id, { ...input, status: 'IN_PROGRESS' });
    });
    return visit;
  }

  async updateVisit(id: string, patch: ClientVisitPatch): Promise<Visit> {
    let updated: Visit | null = null;
    await this.db.transaction(async () => {
      const v = await this.visit(id);
      if (!v) throw new Error('This PM is not on the phone.');
      const now = this.now();
      updated = { ...v, ...patch, client_updated_at: now };
      await this.putVisit(updated);
      await this.enqueue(opKeys.visitUpdate(id), 'visit.update', id, { ...patch, client_updated_at: now }, 'merge');
    });
    return updated!;
  }

  /**
   * Queues the submission after every answer already queued, so the server
   * sees the complete checklist before it checks completeness.
   */
  async submitVisit(id: string): Promise<Visit> {
    let updated: Visit | null = null;
    await this.db.transaction(async () => {
      const v = await this.visit(id);
      if (!v) throw new Error('This PM is not on the phone.');
      const now = this.now();
      updated = { ...v, status: 'SUBMITTED', ended_at: v.ended_at ?? now, client_updated_at: now };
      await this.putVisit(updated);
      await this.db.run('delete from outbox where key = ?', [opKeys.visitSubmit(id)]);
      await this.enqueue(opKeys.visitSubmit(id), 'visit.submit', id, {
        status: 'SUBMITTED',
        ended_at: updated.ended_at,
        client_updated_at: now,
        // Kept on the phone only (not sent), to reopen the PM if the submission is withdrawn.
        previous_status: v.status === 'SUBMITTED' ? 'IN_PROGRESS' : v.status,
      });
    });
    return updated!;
  }

  /**
   * Takes back a submission that has not been accepted (e.g. the server
   * found the checklist incomplete) so the technician can keep editing.
   * Other unsent changes of the visit are kept.
   */
  async withdrawSubmission(id: string): Promise<void> {
    await this.db.transaction(async () => {
      const op = await this.db.first<OpRow>('select * from outbox where key = ?', [opKeys.visitSubmit(id)]);
      if (!op) throw new Error('This PM has already been submitted to the server.');
      if (op.state === 'SYNCING') throw new Error('This PM is being sent now. Try again in a moment.');
      const v = await this.visit(id);
      const previous = (JSON.parse(op.payload) as { previous_status?: Visit['status'] }).previous_status ?? 'IN_PROGRESS';
      await this.db.run('delete from outbox where seq = ?', [op.seq]);
      if (v) await this.putVisit({ ...v, status: previous, ended_at: null });
    });
  }

  // ---- answers -------------------------------------------------------------
  private async putResponse(visitId: string, r: LocalResponse) {
    const row: LocalResponse = {
      checklist_item_id: r.checklist_item_id,
      answer: r.answer,
      numeric_value: r.numeric_value,
      text_value: r.text_value,
      selected_options: r.selected_options,
      date_value: r.date_value,
      datetime_value: r.datetime_value,
      comment: r.comment,
      is_failure: r.is_failure ?? null,
    };
    await this.db.run(
      'insert into responses (visit_id, item_id, json) values (?, ?, ?) on conflict (visit_id, item_id) do update set json = excluded.json',
      [visitId, r.checklist_item_id, JSON.stringify(row)],
    );
  }
  private async putReading(visitId: string, r: LocalReading) {
    const row: LocalReading = { reading_field_id: r.reading_field_id, numeric_value: r.numeric_value, text_value: r.text_value };
    await this.db.run(
      'insert into readings (visit_id, field_id, json) values (?, ?, ?) on conflict (visit_id, field_id) do update set json = excluded.json',
      [visitId, r.reading_field_id, JSON.stringify(row)],
    );
  }

  async saveResponse(visitId: string, r: LocalResponse): Promise<void> {
    const now = this.now();
    await this.db.transaction(async () => {
      // Failure status is decided by the server; drop the stale flag until it answers.
      await this.putResponse(visitId, { ...r, is_failure: null });
      await this.enqueue(opKeys.response(visitId, r.checklist_item_id), 'response.upsert', visitId, {
        visit_id: visitId,
        checklist_item_id: r.checklist_item_id,
        answer: r.answer,
        numeric_value: r.numeric_value,
        text_value: r.text_value,
        selected_options: r.selected_options,
        date_value: r.date_value,
        datetime_value: r.datetime_value,
        comment: r.comment,
        prompt_snapshot: '',
        client_updated_at: now,
      });
    });
  }

  async saveReading(visitId: string, r: LocalReading): Promise<void> {
    const now = this.now();
    await this.db.transaction(async () => {
      await this.putReading(visitId, r);
      await this.enqueue(opKeys.reading(visitId, r.reading_field_id), 'reading.upsert', visitId, {
        visit_id: visitId,
        reading_field_id: r.reading_field_id,
        numeric_value: r.numeric_value,
        text_value: r.text_value,
        label_snapshot: '',
        client_updated_at: now,
      });
    });
  }

  // ---- photos --------------------------------------------------------------
  private async photoRows(visitId: string): Promise<PhotoRow[]> {
    return this.db.all<PhotoRow>('select id, visit_id, item_id, local_uri, thumb_uri, json from photos where visit_id = ?', [visitId]);
  }

  async photos(visitId: string): Promise<LocalPhoto[]> {
    const [rows, pending] = await Promise.all([
      this.db.all<PhotoRow>('select * from photos where visit_id = ? order by created_at', [visitId]),
      this.db.all<{ key: string }>("select key from outbox where visit_id = ? and kind = 'photo.upload'", [visitId]),
    ]);
    const pendingKeys = new Set(pending.map((p) => p.key));
    return rows.map((r) => ({
      ...(JSON.parse(r.json) as Omit<LocalPhoto, 'local_uri' | 'thumb_uri' | 'pending'>),
      local_uri: r.local_uri,
      thumb_uri: r.thumb_uri,
      pending: pendingKeys.has(opKeys.photo(r.id)),
    }));
  }

  async addPhoto(p: PhotoUploadPayload): Promise<void> {
    const { local_uri, thumb_uri, row } = p;
    await this.db.transaction(async () => {
      await this.db.run(
        'insert into photos (id, visit_id, item_id, local_uri, thumb_uri, json, created_at) values (?, ?, ?, ?, ?, ?, ?)',
        [row.id, row.visit_id, row.checklist_item_id, local_uri, thumb_uri, JSON.stringify(row), this.now()],
      );
      await this.enqueue(opKeys.photo(row.id), 'photo.upload', row.visit_id, p as unknown as Record<string, unknown>);
    });
  }

  /** Removes a photo that has not been uploaded yet. Returns its files for deletion. */
  async removeUnsentPhoto(photoId: string): Promise<string[]> {
    let files: string[] = [];
    await this.db.transaction(async () => {
      const op = await this.db.first<{ state: string }>('select state from outbox where key = ?', [opKeys.photo(photoId)]);
      if (!op) throw new Error('This photo is already uploaded and is kept as evidence.');
      if (op.state === 'SYNCING') throw new Error('This photo is uploading now. Try again in a moment.');
      const row = await this.db.first<PhotoRow>('select * from photos where id = ?', [photoId]);
      files = [row?.local_uri, row?.thumb_uri].filter((u): u is string => !!u);
      await this.db.run('delete from outbox where key = ?', [opKeys.photo(photoId)]);
      await this.db.run('delete from photos where id = ?', [photoId]);
    });
    return files;
  }

  // ---- outbox --------------------------------------------------------------
  /**
   * Queues (or coalesces) an operation. A newer edit of the same thing
   * replaces the queued payload ('merge' combines partial visit updates),
   * bumps its version and makes it eligible to send again at once.
   */
  private async enqueue(key: string, kind: OpKind, visitId: string, payload: Record<string, unknown>, mode: 'replace' | 'merge' = 'replace') {
    const now = this.now();
    const existing = await this.db.first<{ payload: string }>('select payload from outbox where key = ?', [key]);
    const next = existing && mode === 'merge' ? { ...(JSON.parse(existing.payload) as object), ...payload } : payload;
    await this.db.run(
      `insert into outbox (key, kind, visit_id, payload, created_at, updated_at) values (?, ?, ?, ?, ?, ?)
       on conflict (key) do update set payload = excluded.payload, state = 'PENDING', version = outbox.version + 1,
         attempts = 0, last_error = null, next_attempt_at = null, updated_at = excluded.updated_at`,
      [key, kind, visitId, JSON.stringify(next), now, now],
    );
  }

  private async opCount(): Promise<number> {
    return (await this.db.first<{ n: number }>('select count(*) as n from outbox'))?.n ?? 0;
  }

  async ops(): Promise<OutboxOp[]> {
    return (await this.db.all<OpRow>('select * from outbox order by seq')).map(toOp);
  }

  async summary(): Promise<OutboxSummary> {
    const ops = await this.ops();
    const waits = ops.map((o) => o.next_attempt_at).filter((t): t is string => !!t).sort();
    return { pending: ops.length, errors: ops.filter((o) => o.state === 'ERROR'), nextAttemptAt: waits[0] ?? null };
  }

  async markSyncing(op: OutboxOp): Promise<void> {
    await this.db.run("update outbox set state = 'SYNCING', updated_at = ? where seq = ? and version = ?", [this.now(), op.seq, op.version]);
  }

  /** Sent. Removed only if nobody changed it meanwhile (else the newer payload is still due). */
  async completeOp(op: OutboxOp): Promise<void> {
    await this.db.run('delete from outbox where seq = ? and version = ?', [op.seq, op.version]);
  }

  /** Could not reach the server: keep it and try again after a back-off. */
  async deferOp(op: OutboxOp, message: string, retryAt: string): Promise<void> {
    await this.db.run(
      "update outbox set state = 'PENDING', attempts = attempts + 1, last_error = ?, next_attempt_at = ?, updated_at = ? where seq = ? and version = ?",
      [message, retryAt, this.now(), op.seq, op.version],
    );
  }

  /** The server refused it: keep it for the technician to see; it is not retried automatically. */
  async rejectOp(op: OutboxOp, message: string): Promise<void> {
    await this.db.run(
      "update outbox set state = 'ERROR', attempts = attempts + 1, last_error = ?, next_attempt_at = null, updated_at = ? where seq = ? and version = ?",
      [message, this.now(), op.seq, op.version],
    );
  }

  /** Makes refused or waiting operations eligible to send again (after the technician fixed the cause). */
  async retry(visitId?: string): Promise<void> {
    const where = visitId ? 'where visit_id = ?' : '';
    const params: SqlParam[] = visitId ? [visitId] : [];
    await this.db.run(`update outbox set state = 'PENDING', next_attempt_at = null ${where}`, params);
  }

  /** Crash recovery: an op left SYNCING by a killed app is simply sent again (all ops are idempotent). */
  async resetSyncing(): Promise<void> {
    await this.db.run("update outbox set state = 'PENDING' where state = 'SYNCING'");
  }

  /**
   * Throws away this visit's unsent changes. A visit the server never
   * received is removed from the phone; otherwise the next download restores
   * the server's copy. Returns files to delete.
   */
  async discardVisitChanges(visitId: string): Promise<string[]> {
    const files: string[] = [];
    await this.db.transaction(async () => {
      const neverSent = await this.db.first('select 1 as x from outbox where key = ?', [opKeys.visitCreate(visitId)]);
      const photos = await this.db.all<PhotoRow>(
        `select p.* from photos p join outbox o on o.key = 'photo:' || p.id where p.visit_id = ?`,
        [visitId],
      );
      for (const p of photos) files.push(...[p.local_uri, p.thumb_uri].filter((u): u is string => !!u));
      await this.db.run(`delete from photos where id in (select substr(key, 7) from outbox where visit_id = ? and kind = 'photo.upload')`, [visitId]);
      await this.db.run('delete from outbox where visit_id = ?', [visitId]);
      if (neverSent) files.push(...(await this.deleteVisitLocally(visitId)));
    });
    return files;
  }

  private async deleteVisitLocally(visitId: string): Promise<string[]> {
    const files = (await this.photoRows(visitId)).flatMap((p) => [p.local_uri, p.thumb_uri].filter((u): u is string => !!u));
    await this.db.run('delete from photos where visit_id = ?', [visitId]);
    await this.db.run('delete from responses where visit_id = ?', [visitId]);
    await this.db.run('delete from readings where visit_id = ?', [visitId]);
    await this.db.run('delete from visits where id = ?', [visitId]);
    return files;
  }

  private async wipe(): Promise<string[]> {
    const files = (await this.db.all<PhotoRow>('select * from photos')).flatMap((p) =>
      [p.local_uri, p.thumb_uri].filter((u): u is string => !!u),
    );
    await this.db.exec('delete from photos; delete from responses; delete from readings; delete from visits; delete from outbox; delete from documents;');
    return files;
  }

  /** Signing out: clears the phone's copy unless unsent work would be lost. */
  async clearForSignOut(): Promise<{ cleared: boolean; removedFiles: string[] }> {
    let result = { cleared: false, removedFiles: [] as string[] };
    await this.db.transaction(async () => {
      if ((await this.opCount()) > 0) return;
      result = { cleared: true, removedFiles: await this.wipe() };
    });
    return result;
  }
}

function serverPhoto(p: SyncBundle['visits'][number]['photos'][number]) {
  return {
    id: p.id,
    visit_id: p.visit_id,
    site_id: p.site_id,
    section_id: p.section_id,
    checklist_item_id: p.checklist_item_id,
    file_path: p.file_path,
    thumbnail_path: p.thumbnail_path,
    mime_type: p.mime_type ?? 'image/jpeg',
    size_bytes: p.size_bytes,
    width: p.width,
    height: p.height,
    latitude: p.latitude,
    longitude: p.longitude,
    taken_at: p.taken_at,
  };
}
