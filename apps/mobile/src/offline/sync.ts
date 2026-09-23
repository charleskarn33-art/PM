import type { LocalStore } from './store';
import type { OutboxOp, PhotoUploadPayload, SyncBundle } from './types';

/**
 * Why a request failed. 'network' (no connection, timeout, server
 * unavailable, expired session) is retried automatically with back-off;
 * 'rejected' means the server refused the change and a person must look.
 */
export class SyncError extends Error {
  constructor(
    readonly kind: 'network' | 'rejected',
    message: string,
  ) {
    super(message);
    this.name = 'SyncError';
  }
}

/** The server side of sync. Every call must be idempotent (ops can be re-sent). */
export interface SyncTransport {
  createVisit(payload: Record<string, unknown>): Promise<void>;
  updateVisit(visitId: string, patch: Record<string, unknown>): Promise<void>;
  /** Must succeed if the visit is already submitted (a resend after the app was killed). */
  submitVisit(visitId: string, patch: Record<string, unknown>): Promise<void>;
  upsertResponse(payload: Record<string, unknown>): Promise<void>;
  upsertReading(payload: Record<string, unknown>): Promise<void>;
  uploadPhoto(payload: PhotoUploadPayload): Promise<void>;
  fetchBundle(): Promise<SyncBundle>;
}

export interface SyncResult {
  sent: number;
  rejected: number;
  /** Stopped early because the server could not be reached. */
  offline: boolean;
  downloaded: boolean;
  error: string | null;
  removedFiles: string[];
}

export const BACKOFF_BASE_MS = 5_000;
export const BACKOFF_MAX_MS = 10 * 60_000;

/** Wait before retrying after `attempts` failed tries: 5 s, 10 s, 20 s … capped at 10 min. */
export function backoffMs(attempts: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempts), BACKOFF_MAX_MS);
}

async function send(transport: SyncTransport, op: OutboxOp): Promise<void> {
  switch (op.kind) {
    case 'visit.create':
      return transport.createVisit(op.payload);
    case 'visit.update':
      return transport.updateVisit(op.visit_id, op.payload);
    case 'visit.submit': {
      const { previous_status: _local, ...patch } = op.payload;
      return transport.submitVisit(op.visit_id, patch);
    }
    case 'response.upsert':
      return transport.upsertResponse(op.payload);
    case 'reading.upsert':
      return transport.upsertReading(op.payload);
    case 'photo.upload':
      return transport.uploadPhoto(op.payload as unknown as PhotoUploadPayload);
  }
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Sends queued changes in the order they were made, then downloads the
 * latest server copy. Order is preserved per visit: once one of a visit's
 * changes is refused or waiting, that visit's later changes wait too
 * (e.g. answers are never sent for a visit the server has not accepted).
 * Only one run happens at a time.
 */
export class SyncEngine {
  private running: Promise<SyncResult> | null = null;

  constructor(
    private readonly store: LocalStore,
    private readonly transport: SyncTransport,
    private readonly userId: string,
    private readonly clock: () => number = Date.now,
  ) {}

  run(opts: { force?: boolean; download?: boolean } = {}): Promise<SyncResult> {
    this.running ??= this.runOnce(opts).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async runOnce({ force = false, download = true }: { force?: boolean; download?: boolean }): Promise<SyncResult> {
    const result: SyncResult = { sent: 0, rejected: 0, offline: false, downloaded: false, error: null, removedFiles: [] };
    const owner = await this.store.ownerId();
    if (owner && owner !== this.userId) {
      result.error = 'This phone has unsent PM work from another account. Sign in as that user to send it.';
      return result;
    }
    await this.store.resetSyncing();

    const held = new Set<string>();
    for (const op of await this.store.ops()) {
      if (held.has(op.visit_id)) continue;
      if (op.state === 'ERROR') {
        held.add(op.visit_id);
        continue;
      }
      if (!force && op.next_attempt_at && Date.parse(op.next_attempt_at) > this.clock()) {
        held.add(op.visit_id);
        continue;
      }
      await this.store.markSyncing(op);
      try {
        await send(this.transport, op);
        await this.store.completeOp(op);
        result.sent += 1;
      } catch (e) {
        const message = messageOf(e);
        if (e instanceof SyncError && e.kind === 'rejected') {
          await this.store.rejectOp(op, message);
          result.rejected += 1;
          held.add(op.visit_id);
          continue;
        }
        await this.store.deferOp(op, message, new Date(this.clock() + backoffMs(op.attempts)).toISOString());
        result.offline = true;
        result.error = message;
        return result;
      }
    }

    if (!download) return result;
    try {
      const bundle = await this.transport.fetchBundle();
      const applied = await this.store.applyBundle(bundle, this.userId);
      result.removedFiles = applied.removedFiles;
      result.downloaded = true;
    } catch (e) {
      result.offline = e instanceof SyncError ? e.kind === 'network' : false;
      result.error = messageOf(e);
    }
    return result;
  }
}
