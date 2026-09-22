import type { Enums } from '../database.types';

export type PmFrequency = Enums<'pm_frequency'>;

const MONTHS: Partial<Record<PmFrequency, number>> = {
  MONTHLY: 1,
  BIMONTHLY: 2,
  QUARTERLY: 3,
  SEMIANNUAL: 6,
  ANNUAL: 12,
};
const DAYS: Partial<Record<PmFrequency, number>> = { WEEKLY: 7, BIWEEKLY: 14 };

function parse(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}
function format(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Adds calendar months, clamping to the month end (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(iso: string, months: number): string {
  const d = parse(iso);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return format(target);
}

export function addDays(iso: string, days: number): string {
  const d = parse(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return format(d);
}

/**
 * Scheduled dates for `count` occurrences starting at `start` (YYYY-MM-DD).
 * Occurrences are computed from the start date (not chained) so month-end
 * clamping never drifts. AD_HOC yields a single occurrence.
 */
export function occurrenceDates(frequency: PmFrequency, start: string, count: number): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) throw new Error('Start date must be YYYY-MM-DD');
  const n = frequency === 'AD_HOC' ? 1 : Math.max(0, Math.floor(count));
  return Array.from({ length: n }, (_, i) => {
    if (DAYS[frequency]) return addDays(start, DAYS[frequency]! * i);
    return addMonths(start, (MONTHS[frequency] ?? 0) * i);
  });
}

export const MAX_OCCURRENCES = 24;
