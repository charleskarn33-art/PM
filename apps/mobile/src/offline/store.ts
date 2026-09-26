/**
 * The phone's offline store (SQLite): saved copies of what the server sent
 * (read-only lists, the field pack, visits) and the outbox of changes made on
 * the phone that the server has not accepted yet. Everything is kept per
 * signed-in user; another user on the same phone sees none of it.
 */
import type { VisitDetail } from '../lib/api/types';
import { Mutex, type SqlDb, type SqlValue } from './sql';
import { currentVisit, mergeInto, visitSyncStatus, type Op, type OpInput, type OpStatus, type SyncStatus } from './visit-ops';

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS cache (
     user_id TEXT NOT NULL, key TEXT NOT NULL, json TEXT NOT NULL, saved_at TEXT NOT NULL,
     PRIMARY KEY (user_id, key));
   CREATE TABLE IF NOT EXISTS visits (
     user_id TEXT NOT NULL, id TEXT NOT NULL, base_json TEXT NOT NULL, from_server INTEGER NOT NULL,
     saved_at TEXT NOT NULL, notice TEXT,
     PRIMARY KEY (user_id, id));
   CREATE TABLE IF NOT EXISTS outbox (
     seq INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, visit_id TEXT NOT NULL,
     kind TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL,
     attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL DEFAULT 0,
     last_error TEXT, last_error_details TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS outbox_user_visit ON outbox (user_id, visit_id, seq);`,
];

/** Creates or upgrades the tables (numbered migrations, recorded in user_version). */
export async function migrate(db: SqlDb): Promise<void> {
  const [row] = await db.all<{ user_version: number }>('PRAGMA user_version');
  const version = row?.user_version ?? 0;
  for (let v = version; v < MIGRATIONS.length; v++) {
    await db.exec(`BEGIN; ${MIGRATIONS[v]} PRAGMA user_version = ${v + 1}; COMMIT;`);
  }
}

interface OpRow {
  seq: number;
  visit_id: string;
  kind: Op['kind'];
  payload: string;
  status: OpStatus;
  attempts: number;
  next_attempt_at: number;
  last_error: string | null;
  last_error_details: string | null;
  created_at: string;
}

export type StoredOp = Op & { lastErrorDetails: unknown };

const toOp = (r: OpRow): StoredOp =>
  ({
    seq: r.seq,
    visitId: r.visit_id,
    kind: r.kind,
    payload: JSON.parse(r.payload),
    status: r.status,
    attempts: r.attempts,
    nextAttemptAt: r.next_attempt_at,
    lastError: r.last_error,
    lastErrorDetails: r.last_error_details ? JSON.parse(r.last_error_details) : null,
    createdAt: r.created_at,
  }) as StoredOp;

export interface VisitView {
  visit: VisitDetail;
  syncStatus: SyncStatus;
  ops: StoredOp[];
  /** Set when the server kept newer values than some sent from this phone. */
  notice: string | null;
  fromServer: boolean;
  savedAt: string;
}

export interface OutboxCounts {
  pending: number;
  syncing: number;
  errors: number;
}

export class OfflineStore {
  private readonly lock = new Mutex();
  private readonly listeners = new Set<(visitId: string | null) => void>();

  constructor(
    private readonly db: SqlDb,
    readonly userId: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Called after every change (with the visit concerned, or null). */
  onChange(listener: (visitId: string | null) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(visitId: string | null) {
    this.listeners.forEach((l) => l(visitId));
  }

  private tx<T>(task: () => Promise<T>): Promise<T> {
    return this.lock.run(async () => {
      await this.db.exec('BEGIN');
      try {
        const out = await task();
        await this.db.exec('COMMIT');
        return out;
      } catch (e) {
        await this.db.exec('ROLLBACK').catch(() => undefined);
        throw e;
      }
    });
  }

  private read<T>(sql: string, params: SqlValue[]): Promise<T[]> {
    return this.lock.run(() => this.db.all<T>(sql, params));
  }

  // --- Saved copies --------------------------------------------------------------------

  async getCache<T>(key: string): Promise<{ data: T; savedAt: string } | null> {
    const [row] = await this.read<{ json: string; saved_at: string }>('SELECT json, saved_at FROM cache WHERE user_id = ? AND key = ?', [this.userId, key]);
    return row ? { data: JSON.parse(row.json) as T, savedAt: row.saved_at } : null;
  }

  async setCache(key: string, data: unknown): Promise<void> {
    await this.lock.run(() =>
      this.db.run('INSERT INTO cache (user_id, key, json, saved_at) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, key) DO UPDATE SET json = excluded.json, saved_at = excluded.saved_at', [
        this.userId,
        key,
        JSON.stringify(data),
        this.now().toISOString(),
      ]),
    );
  }

  // --- Visits ------------------------------------------------------------------------------

  /** Keeps the server's copy of a visit (or, for a visit started on the phone, the phone's). */
  async saveBase(visit: VisitDetail, fromServer: boolean, notice?: string | null): Promise<void> {
    const { skipped: _s, skippedBatteryUnits: _b, ...clean } = visit as VisitDetail & { skipped?: unknown; skippedBatteryUnits?: unknown };
    await this.lock.run(() =>
      this.db.run(
        `INSERT INTO visits (user_id, id, base_json, from_server, saved_at, notice) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, id) DO UPDATE SET base_json = excluded.base_json, from_server = MAX(visits.from_server, excluded.from_server),
           saved_at = excluded.saved_at, notice = COALESCE(excluded.notice, visits.notice)`,
        [this.userId, visit.id, JSON.stringify(clean), fromServer ? 1 : 0, this.now().toISOString(), notice ?? null],
      ),
    );
    this.changed(visit.id);
  }

  async clearNotice(visitId: string): Promise<void> {
    await this.lock.run(() => this.db.run('UPDATE visits SET notice = NULL WHERE user_id = ? AND id = ?', [this.userId, visitId]));
    this.changed(visitId);
  }

  async hasVisit(visitId: string): Promise<boolean> {
    return (await this.read('SELECT 1 FROM visits WHERE user_id = ? AND id = ?', [this.userId, visitId])).length > 0;
  }

  /** The visit as the technician sees it (saved copy plus queued changes). */
  async visit(visitId: string): Promise<VisitView | null> {
    const [row] = await this.read<{ base_json: string; from_server: number; notice: string | null; saved_at: string }>(
      'SELECT base_json, from_server, notice, saved_at FROM visits WHERE user_id = ? AND id = ?',
      [this.userId, visitId],
    );
    if (!row) return null;
    const ops = await this.ops(visitId);
    return this.view(row, ops);
  }

  /** Every visit kept on the phone, newest first. */
  async visits(): Promise<VisitView[]> {
    const rows = await this.read<{ id: string; base_json: string; from_server: number; notice: string | null; saved_at: string }>(
      'SELECT id, base_json, from_server, notice, saved_at FROM visits WHERE user_id = ?',
      [this.userId],
    );
    const ops = await this.ops();
    return rows
      .map((r) => this.view(r, ops.filter((o) => o.visitId === r.id)))
      .sort((a, b) => b.visit.startedAt.localeCompare(a.visit.startedAt));
  }

  private view(row: { base_json: string; from_server: number; notice: string | null; saved_at: string }, ops: StoredOp[]): VisitView {
    const base = JSON.parse(row.base_json) as VisitDetail;
    return { visit: currentVisit(base, ops), syncStatus: visitSyncStatus(row.from_server === 1, ops), ops, notice: row.notice, fromServer: row.from_server === 1, savedAt: row.saved_at };
  }

  /**
   * Forgets visits the server no longer lists as open and that have nothing
   * waiting to be sent (they are finished; the server keeps them).
   */
  async pruneVisits(openIds: readonly string[]): Promise<void> {
    const keep = new Set(openIds);
    await this.tx(async () => {
      const rows = await this.db.all<{ id: string }>(
        `SELECT id FROM visits v WHERE user_id = ? AND from_server = 1
           AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.user_id = v.user_id AND o.visit_id = v.id)`,
        [this.userId],
      );
      for (const r of rows) if (!keep.has(r.id)) await this.db.run('DELETE FROM visits WHERE user_id = ? AND id = ?', [this.userId, r.id]);
    });
    this.changed(null);
  }

  // --- Outbox --------------------------------------------------------------------------------

  async ops(visitId?: string): Promise<StoredOp[]> {
    const rows = await this.read<OpRow>(
      `SELECT * FROM outbox WHERE user_id = ?${visitId ? ' AND visit_id = ?' : ''} ORDER BY seq`,
      visitId ? [this.userId, visitId] : [this.userId],
    );
    return rows.map(toOp);
  }

  /**
   * Queues a change. A burst of edits joins the last queued change of the same
   * kind; a photo removed before it was uploaded is simply dropped. Returns the
   * phone files no longer needed.
   */
  async enqueue(visitId: string, op: OpInput): Promise<{ unusedFiles: string[] }> {
    const at = this.now().toISOString();
    const unusedFiles: string[] = [];
    await this.tx(async () => {
      const [tail] = (await this.db.all<OpRow>('SELECT * FROM outbox WHERE user_id = ? AND visit_id = ? ORDER BY seq DESC LIMIT 1', [this.userId, visitId])).map(toOp);
      if (tail && tail.status === 'PENDING_SYNC') {
        // A photo never tried is dropped; one tried may already be on the server, so it is deleted there.
        if (op.kind === 'photo_delete' && tail.kind === 'photo' && tail.payload.id === op.payload.photoId && tail.attempts === 0) {
          await this.db.run('DELETE FROM outbox WHERE seq = ?', [tail.seq]);
          unusedFiles.push(tail.payload.localUri);
          return;
        }
        const merged = mergeInto(tail, op);
        if (merged) {
          await this.db.run('UPDATE outbox SET payload = ?, updated_at = ? WHERE seq = ?', [JSON.stringify(merged.payload), at, tail.seq]);
          return;
        }
      }
      await this.db.run('INSERT INTO outbox (user_id, visit_id, kind, payload, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
        this.userId,
        visitId,
        op.kind,
        JSON.stringify(op.payload),
        'PENDING_SYNC',
        at,
        at,
      ]);
    });
    this.changed(visitId);
    return { unusedFiles };
  }

  /**
   * The changes to send now: for each visit, its oldest queued change, when it
   * is waiting and due (changes of one visit are sent strictly in order; a
   * visit whose change was refused waits for the technician).
   */
  async due(nowMs: number): Promise<StoredOp[]> {
    const ops = await this.ops();
    const first = new Map<string, StoredOp>();
    for (const o of ops) if (!first.has(o.visitId)) first.set(o.visitId, o);
    return [...first.values()].filter((o) => o.status === 'PENDING_SYNC' && o.nextAttemptAt <= nowMs).sort((a, b) => a.seq - b.seq);
  }

  /** When the next waiting change may be retried (ms), or null. */
  async nextAttemptAt(): Promise<number | null> {
    const [row] = await this.read<{ at: number | null }>("SELECT MIN(next_attempt_at) AS at FROM outbox WHERE user_id = ? AND status = 'PENDING_SYNC'", [this.userId]);
    return row?.at ?? null;
  }

  async markSyncing(seq: number): Promise<void> {
    await this.setStatus(seq, 'SYNCING');
  }

  /** The server accepted the change: drop it and keep the server's copy of the visit. */
  async accepted(op: StoredOp, visit: VisitDetail | null, notice?: string | null): Promise<void> {
    await this.lock.run(() => this.db.run('DELETE FROM outbox WHERE seq = ?', [op.seq]));
    if (visit) await this.saveBase(visit, true, notice);
    else this.changed(op.visitId);
  }

  /** Could not be sent now (no connection, server busy): retried later. */
  async postpone(seq: number, error: string, nextAttemptAt: number): Promise<void> {
    await this.lock.run(() =>
      this.db.run("UPDATE outbox SET status = 'PENDING_SYNC', attempts = attempts + 1, next_attempt_at = ?, last_error = ?, updated_at = ? WHERE seq = ?", [
        nextAttemptAt,
        error,
        this.now().toISOString(),
        seq,
      ]),
    );
    this.changed(null);
  }

  /** The server refused the change: it waits for the technician (retry or discard). */
  async refused(seq: number, error: string, details: unknown): Promise<void> {
    await this.lock.run(() =>
      this.db.run("UPDATE outbox SET status = 'SYNC_ERROR', attempts = attempts + 1, last_error = ?, last_error_details = ?, updated_at = ? WHERE seq = ?", [
        error,
        details === undefined ? null : JSON.stringify(details),
        this.now().toISOString(),
        seq,
      ]),
    );
    this.changed(null);
  }

  /** Sends a visit's refused and waiting changes again now. */
  async retry(visitId?: string): Promise<void> {
    await this.lock.run(() =>
      this.db.run(
        `UPDATE outbox SET status = 'PENDING_SYNC', next_attempt_at = 0, updated_at = ? WHERE user_id = ? AND status IN ('SYNC_ERROR', 'PENDING_SYNC')${visitId ? ' AND visit_id = ?' : ''}`,
        visitId ? [this.now().toISOString(), this.userId, visitId] : [this.now().toISOString(), this.userId],
      ),
    );
    this.changed(visitId ?? null);
  }

  /**
   * Drops a refused change. Dropping the start of a visit begun on the phone
   * drops the whole visit (nothing of it reached the server). Returns the
   * phone files no longer needed.
   */
  async discard(seq: number): Promise<{ unusedFiles: string[]; visitRemoved: boolean }> {
    const out = await this.tx(async () => {
      const [op] = (await this.db.all<OpRow>('SELECT * FROM outbox WHERE user_id = ? AND seq = ?', [this.userId, seq])).map(toOp);
      if (!op) return { unusedFiles: [], visitRemoved: false, visitId: null };
      const drop = op.kind === 'start' ? (await this.db.all<OpRow>('SELECT * FROM outbox WHERE user_id = ? AND visit_id = ?', [this.userId, op.visitId])).map(toOp) : [op];
      for (const o of drop) await this.db.run('DELETE FROM outbox WHERE seq = ?', [o.seq]);
      if (op.kind === 'start') await this.db.run('DELETE FROM visits WHERE user_id = ? AND id = ?', [this.userId, op.visitId]);
      return { unusedFiles: drop.flatMap((o) => (o.kind === 'photo' ? [o.payload.localUri] : [])), visitRemoved: op.kind === 'start', visitId: op.visitId };
    });
    this.changed(out.visitId);
    return { unusedFiles: out.unusedFiles, visitRemoved: out.visitRemoved };
  }

  /** After the app was closed mid-send: those changes are sent again (every change is safe to resend). */
  async resetInterrupted(): Promise<void> {
    await this.lock.run(() => this.db.run("UPDATE outbox SET status = 'PENDING_SYNC' WHERE user_id = ? AND status = 'SYNCING'", [this.userId]));
  }

  async counts(): Promise<OutboxCounts> {
    const rows = await this.read<{ status: OpStatus; n: number }>('SELECT status, COUNT(*) AS n FROM outbox WHERE user_id = ? GROUP BY status', [this.userId]);
    const n = (s: OpStatus) => rows.find((r) => r.status === s)?.n ?? 0;
    return { pending: n('PENDING_SYNC'), syncing: n('SYNCING'), errors: n('SYNC_ERROR') };
  }

  private async setStatus(seq: number, status: OpStatus) {
    await this.lock.run(() => this.db.run('UPDATE outbox SET status = ?, updated_at = ? WHERE seq = ?', [status, this.now().toISOString(), seq]));
    this.changed(null);
  }
}
