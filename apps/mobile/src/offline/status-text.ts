import type { StatusTone } from '@ipt/shared';

export interface SyncStatusInput {
  syncing: boolean;
  online: boolean | null;
  pending: number;
  errors: number;
  lastSyncedAt: string | null;
  lastError: string | null;
}

/** "3 min ago" style age of the last successful download. */
export function timeAgo(iso: string | null, now: number): string {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** One-line sync summary and its colour, for the bar shown on the main screens. */
export function syncSummary(s: SyncStatusInput, now: number): { tone: StatusTone; text: string } {
  const waiting = s.pending - s.errors;
  const last = `Last synced ${timeAgo(s.lastSyncedAt, now)}`;
  if (s.errors > 0) return { tone: 'danger', text: `${s.errors} change(s) refused by the server — tap to review` };
  if (s.syncing) return { tone: 'info', text: waiting > 0 ? `Sending ${waiting} change(s)…` : 'Syncing…' };
  if (s.online === false) {
    return { tone: 'warning', text: waiting > 0 ? `Offline — ${waiting} change(s) saved on phone` : `Offline — ${last.toLowerCase()}` };
  }
  if (waiting > 0) return { tone: 'warning', text: `${waiting} change(s) waiting to send${s.lastError ? ' (retrying)' : ''}` };
  if (!s.lastSyncedAt) return { tone: 'warning', text: s.lastError ? `Not downloaded yet: ${s.lastError}` : 'Not downloaded yet' };
  return { tone: 'success', text: `All changes sent · ${last.toLowerCase()}` };
}
