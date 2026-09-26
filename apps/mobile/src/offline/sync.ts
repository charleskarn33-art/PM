/**
 * Sends the outbox to the API and keeps the saved copies fresh
 * (platform-independent: the API client, photo form and file removal are
 * injected, so this is unit-tested in Node).
 *
 * - One run at a time; changes of one visit are sent strictly in order.
 * - No connection or a server problem (5xx, 408, 429): the change waits and
 *   is retried with exponential back-off.
 * - Refused by the server (other 4xx): the change is marked SYNC_ERROR and
 *   waits for the technician (retry, or discard it).
 * - Every change is safe to send twice (client ids, clientUpdatedAt), so a
 *   send interrupted after the server acted is simply sent again.
 */
import { ApiError } from '../lib/api/session-client';
import type { FieldPack, VisitDetail } from '../lib/api/types';
import type { OfflineStore, StoredOp } from './store';
import { retryDelayMs, type PhotoPayload } from './visit-ops';

export interface SyncApi {
  request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<{ data: T; meta?: Record<string, unknown> }>;
  upload<T>(path: string, form: FormData): Promise<{ data: T }>;
}

export interface SyncDeps {
  store: OfflineStore;
  api: SyncApi;
  /** The multipart body for a photo (React Native reads the file from its uri). */
  photoForm: (p: PhotoPayload) => FormData;
  /** Removes a phone file that is no longer needed (never throws). */
  deleteFile: (uri: string) => void;
  now?: () => number;
  random?: () => number;
}

export interface SyncResult {
  sent: number;
  refused: number;
  /** The run stopped because there is no connection. */
  offline: boolean;
}

type Outcome = { visit: VisitDetail | null; notice: string | null };

export class SyncEngine {
  private running: Promise<SyncResult> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly now: () => number;

  constructor(private readonly deps: SyncDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** Server work done one task at a time, so an older copy never replaces a newer one. */
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Sends what is due. Concurrent callers share one run. */
  sync(): Promise<SyncResult> {
    this.running ??= this.serial(() => this.run()).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** Downloads the field pack, keeping its open visits (between sends, never during one). */
  refreshPack(): Promise<FieldPack> {
    return this.serial(async () => {
      const { data } = await this.deps.api.request<FieldPack>('/field/pack');
      await this.deps.store.setCache('pack', data);
      for (const v of data.visits) await this.deps.store.saveBase(v, true);
      await this.deps.store.pruneVisits([...data.visits.map((v) => v.id), ...data.moreVisitIds]);
      return data;
    });
  }

  /** Fetches the server's copy of one visit (the queued changes stay on top of it). */
  refreshVisit(visitId: string): Promise<VisitDetail> {
    return this.serial(async () => {
      const { data } = await this.deps.api.request<VisitDetail>(`/visits/${visitId}`);
      await this.deps.store.saveBase(data, true);
      return data;
    });
  }

  private async run(): Promise<SyncResult> {
    const result: SyncResult = { sent: 0, refused: 0, offline: false };
    const { store } = this.deps;
    await store.resetInterrupted();
    // Loop: sending one change of a visit makes its next change due.
    for (;;) {
      const due = await store.due(this.now());
      if (!due.length) return result;
      for (const op of due) {
        await store.markSyncing(op.seq);
        try {
          const out = await this.send(op);
          await store.accepted(op, out.visit, out.notice);
          if (op.kind === 'photo') this.deps.deleteFile(op.payload.localUri);
          result.sent += 1;
        } catch (e) {
          const err = e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', e instanceof Error ? e.message : 'The change could not be sent.');
          if (isTransient(err)) {
            await store.postpone(op.seq, err.message, this.now() + retryDelayMs(op.attempts + 1, this.deps.random));
            if (err.offline || err.status === 401) {
              result.offline = err.offline;
              return result; // no point trying the others now
            }
          } else {
            await store.refused(op.seq, err.message, err.details);
            result.refused += 1;
          }
        }
      }
    }
  }

  private async send(op: StoredOp): Promise<Outcome> {
    const { api } = this.deps;
    const v = `/visits/${op.visitId}`;
    const fetchVisit = async () => (await api.request<VisitDetail>(v)).data;
    switch (op.kind) {
      case 'start': {
        const { data } = await api.request<VisitDetail>('/visits', { method: 'POST', body: op.payload });
        if (data.id !== op.visitId) throw new ApiError(409, 'VISIT_EXISTS', 'This PM was already started (another visit is open for it). Discard this one and continue the open PM.');
        return { visit: data, notice: null };
      }
      case 'answers': {
        const { data } = await api.request<VisitDetail & { skipped?: unknown[] }>(`${v}/answers`, { method: 'PUT', body: op.payload });
        const n = data.skipped?.length ?? 0;
        return { visit: data, notice: n ? `${n} value${n === 1 ? ' was' : 's were'} changed more recently on another device; the newer value${n === 1 ? ' was' : 's were'} kept.` : null };
      }
      case 'battery': {
        const { data } = await api.request<VisitDetail & { skippedBatteryUnits?: number[] }>(`${v}/battery-units`, { method: 'PUT', body: op.payload });
        const n = data.skippedBatteryUnits?.length ?? 0;
        return { visit: data, notice: n ? `Battery ${data.skippedBatteryUnits!.join(', ')}: a newer voltage from another device was kept.` : null };
      }
      case 'photo':
        await api.upload(`${v}/photos`, this.deps.photoForm(op.payload));
        return { visit: await fetchVisit(), notice: null };
      case 'photo_delete':
        try {
          await api.request(`${v}/photos/${op.payload.photoId}`, { method: 'DELETE' });
        } catch (e) {
          if (!(e instanceof ApiError && e.status === 404)) throw e; // already gone
        }
        return { visit: await fetchVisit(), notice: null };
      case 'sign':
        return { visit: (await api.request<VisitDetail>(`${v}/signature`, { method: 'PUT', body: op.payload })).data, notice: null };
      case 'complete':
        try {
          return { visit: (await api.request<VisitDetail>(`${v}/complete`, { method: 'POST' })).data, notice: null };
        } catch (e) {
          // Sent before, but the answer was lost: the visit is already completed.
          if (e instanceof ApiError && e.code === 'VISIT_LOCKED') {
            const visit = await fetchVisit();
            if (visit.status === 'COMPLETED' || visit.status === 'APPROVED') return { visit, notice: null };
          }
          throw e;
        }
    }
  }
}

/** Worth retrying later without the technician doing anything. */
export function isTransient(e: ApiError): boolean {
  return e.offline || e.status >= 500 || e.status === 408 || e.status === 429 || e.status === 401;
}
