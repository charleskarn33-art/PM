/**
 * Failure and corrective-action rules, as pure functions (unit-tested).
 *
 * Corrective action: OPEN (not assigned) → ASSIGNED → IN_PROGRESS →
 * COMPLETED → VERIFIED → CLOSED. Verification can send it back to
 * IN_PROGRESS; an action not started yet can be withdrawn (CLOSED without
 * verification).
 *
 * A failure's status follows its actions: the least advanced action that
 * counts decides (an unassigned action leaves the failure OPEN; all actions
 * closed after verification close it). Withdrawn actions, and actions closed
 * before the failure was reopened, do not count. A failure closed by hand
 * (with a note) stays closed until reopened.
 */

export type ActionStatus = 'OPEN' | 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'VERIFIED' | 'CLOSED';
export type FailureStatus = 'OPEN' | 'ASSIGNED' | 'IN_PROGRESS' | 'RESOLVED' | 'VERIFIED' | 'CLOSED';

export interface ActionForStatus {
  status: ActionStatus;
  verifiedAt: Date | null;
  closedAt: Date | null;
}

/** Closed without being verified: withdrawn, does not count. */
export const isWithdrawn = (a: ActionForStatus) => a.status === 'CLOSED' && a.verifiedAt == null;

const RANK: Record<ActionStatus, number> = { OPEN: 0, ASSIGNED: 1, IN_PROGRESS: 2, COMPLETED: 3, VERIFIED: 4, CLOSED: 5 };
const FAILURE_BY_RANK: FailureStatus[] = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'VERIFIED', 'CLOSED'];

/** The failure's status from its actions (and whether it was closed by hand). */
export function failureStatus(input: { closedByHand: boolean; reopenedAt: Date | null; actions: readonly ActionForStatus[] }): FailureStatus {
  if (input.closedByHand) return 'CLOSED';
  const counting = input.actions.filter((a) => !isWithdrawn(a) && !(a.status === 'CLOSED' && input.reopenedAt && a.closedAt && a.closedAt <= input.reopenedAt));
  if (!counting.length) return 'OPEN';
  return FAILURE_BY_RANK[Math.min(...counting.map((a) => RANK[a.status]))]!;
}

/**
 * Timestamps that go with a status: set when first reached, kept while the
 * status stays at or beyond it, cleared when it goes back.
 */
export function failureTimestamps(
  status: FailureStatus,
  current: { resolvedAt: Date | null; verifiedAt: Date | null; closedAt: Date | null },
  now: Date,
): { resolvedAt: Date | null; verifiedAt: Date | null; closedAt: Date | null } {
  const rank = FAILURE_BY_RANK.indexOf(status);
  const at = (reached: number, value: Date | null) => (rank >= reached ? (value ?? now) : null);
  return { resolvedAt: at(3, current.resolvedAt), verifiedAt: at(4, current.verifiedAt), closedAt: at(5, current.closedAt) };
}

export type ActionStep = 'assign' | 'start' | 'complete' | 'approve' | 'reject' | 'close';

const FROM: Record<ActionStep, readonly ActionStatus[]> = {
  assign: ['OPEN', 'ASSIGNED', 'IN_PROGRESS'],
  start: ['ASSIGNED'],
  complete: ['IN_PROGRESS'],
  approve: ['COMPLETED'],
  reject: ['COMPLETED'],
  close: ['OPEN', 'ASSIGNED', 'VERIFIED'],
};

const TO: Record<ActionStep, ActionStatus> = {
  assign: 'ASSIGNED',
  start: 'IN_PROGRESS',
  complete: 'COMPLETED',
  approve: 'VERIFIED',
  reject: 'IN_PROGRESS',
  close: 'CLOSED',
};

/** The status after a step, or null when the step is not possible from `from`. */
export function nextActionStatus(from: ActionStatus, step: ActionStep): ActionStatus | null {
  return FROM[step].includes(from) ? TO[step] : null;
}

export const ACTIVE_ACTION: readonly ActionStatus[] = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED'];

export const failureNumber = (n: number) => `FL-${String(n).padStart(6, '0')}`;
export const actionNumber = (n: number) => `CA-${String(n).padStart(6, '0')}`;
