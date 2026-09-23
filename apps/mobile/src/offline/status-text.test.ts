import { describe, expect, it } from 'vitest';
import { syncSummary, timeAgo } from './status-text';

const NOW = Date.parse('2026-09-23T12:00:00Z');
const base = { syncing: false, online: true, pending: 0, errors: 0, lastSyncedAt: '2026-09-23T11:57:00Z', lastError: null };

describe('sync summary', () => {
  it('formats ages', () => {
    expect(timeAgo(null, NOW)).toBe('never');
    expect(timeAgo('2026-09-23T11:59:30Z', NOW)).toBe('just now');
    expect(timeAgo('2026-09-23T09:00:00Z', NOW)).toBe('3 h ago');
    expect(timeAgo('2026-09-20T12:00:00Z', NOW)).toBe('3 days ago');
  });
  it('puts refused changes first, then offline / waiting, then all sent', () => {
    expect(syncSummary({ ...base, pending: 3, errors: 1 }, NOW).tone).toBe('danger');
    expect(syncSummary({ ...base, online: false, pending: 2 }, NOW).text).toBe('Offline — 2 change(s) saved on phone');
    expect(syncSummary({ ...base, pending: 2, lastError: 'timeout' }, NOW).text).toBe('2 change(s) waiting to send (retrying)');
    expect(syncSummary(base, NOW)).toEqual({ tone: 'success', text: 'All changes sent · last synced 3 min ago' });
    expect(syncSummary({ ...base, lastSyncedAt: null }, NOW).text).toBe('Not downloaded yet');
  });
});
