import { describe, expect, it } from 'vitest';
import { actionNumber, failureNumber, failureStatus, failureTimestamps, nextActionStatus, type ActionForStatus, type ActionStatus } from './failure-rules.js';

const t = (h: number) => new Date(Date.UTC(2026, 8, 20, h));
const a = (status: ActionStatus, extra: Partial<ActionForStatus> = {}): ActionForStatus => ({
  status,
  verifiedAt: status === 'VERIFIED' || status === 'CLOSED' ? t(5) : null,
  closedAt: status === 'CLOSED' ? t(6) : null,
  ...extra,
});
const status = (actions: ActionForStatus[], extra: { closedByHand?: boolean; reopenedAt?: Date | null } = {}) =>
  failureStatus({ closedByHand: extra.closedByHand ?? false, reopenedAt: extra.reopenedAt ?? null, actions });

describe('failure status follows its corrective actions', () => {
  it('the least advanced action decides', () => {
    expect(status([])).toBe('OPEN');
    expect(status([a('OPEN')])).toBe('OPEN');
    expect(status([a('ASSIGNED')])).toBe('ASSIGNED');
    expect(status([a('IN_PROGRESS'), a('COMPLETED')])).toBe('IN_PROGRESS');
    expect(status([a('COMPLETED'), a('VERIFIED')])).toBe('RESOLVED');
    expect(status([a('VERIFIED'), a('CLOSED')])).toBe('VERIFIED');
    expect(status([a('CLOSED'), a('CLOSED')])).toBe('CLOSED');
  });

  it('withdrawn actions and actions closed before a reopen do not count; closing by hand wins', () => {
    const withdrawn = a('CLOSED', { verifiedAt: null });
    expect(status([withdrawn])).toBe('OPEN');
    expect(status([withdrawn, a('ASSIGNED')])).toBe('ASSIGNED');
    expect(status([a('CLOSED')], { reopenedAt: t(7) })).toBe('OPEN');
    expect(status([a('CLOSED')], { reopenedAt: t(4) })).toBe('CLOSED');
    expect(status([a('IN_PROGRESS')], { closedByHand: true })).toBe('CLOSED');
  });

  it('timestamps are set when reached, kept, and cleared when the status goes back', () => {
    const none = { resolvedAt: null, verifiedAt: null, closedAt: null };
    expect(failureTimestamps('RESOLVED', none, t(1))).toEqual({ resolvedAt: t(1), verifiedAt: null, closedAt: null });
    expect(failureTimestamps('CLOSED', { resolvedAt: t(1), verifiedAt: null, closedAt: null }, t(3))).toEqual({ resolvedAt: t(1), verifiedAt: t(3), closedAt: t(3) });
    expect(failureTimestamps('IN_PROGRESS', { resolvedAt: t(1), verifiedAt: t(2), closedAt: t(3) }, t(4))).toEqual(none);
  });
});

describe('corrective action steps', () => {
  it('assign → start → complete → verify → close, with rework and withdrawal', () => {
    expect(nextActionStatus('OPEN', 'assign')).toBe('ASSIGNED');
    expect(nextActionStatus('IN_PROGRESS', 'assign')).toBe('ASSIGNED');
    expect(nextActionStatus('ASSIGNED', 'start')).toBe('IN_PROGRESS');
    expect(nextActionStatus('IN_PROGRESS', 'complete')).toBe('COMPLETED');
    expect(nextActionStatus('COMPLETED', 'approve')).toBe('VERIFIED');
    expect(nextActionStatus('COMPLETED', 'reject')).toBe('IN_PROGRESS');
    expect(nextActionStatus('VERIFIED', 'close')).toBe('CLOSED');
    expect(nextActionStatus('ASSIGNED', 'close')).toBe('CLOSED');
  });

  it('refuses skipped steps', () => {
    expect(nextActionStatus('OPEN', 'start')).toBeNull();
    expect(nextActionStatus('ASSIGNED', 'complete')).toBeNull();
    expect(nextActionStatus('IN_PROGRESS', 'approve')).toBeNull();
    expect(nextActionStatus('IN_PROGRESS', 'close')).toBeNull();
    expect(nextActionStatus('COMPLETED', 'close')).toBeNull();
    expect(nextActionStatus('CLOSED', 'assign')).toBeNull();
  });

  it('numbers', () => {
    expect(failureNumber(42)).toBe('FL-000042');
    expect(actionNumber(7)).toBe('CA-000007');
  });
});
