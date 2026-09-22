import type { Enums } from '../database.types';

/** Statuses in which a PM still has to be carried out. */
export const OPEN_PM_STATUSES: ReadonlyArray<Enums<'pm_status'>> = ['SCHEDULED', 'IN_PROGRESS', 'OVERDUE'];

/**
 * A PM is overdue when it is still open and its due date (YYYY-MM-DD) is
 * before `today` (YYYY-MM-DD, in the organisation's local date).
 */
export function isPmOverdue(status: Enums<'pm_status'>, dueDate: string, today: string): boolean {
  if (status === 'OVERDUE') return true;
  return OPEN_PM_STATUSES.includes(status) && dueDate < today;
}

/** Local calendar date as YYYY-MM-DD. */
export function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
