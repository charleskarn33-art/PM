/** Calendar dates as YYYY-MM-DD strings, stored in DATE columns (UTC midnight). */

export type Frequency = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'BIMONTHLY' | 'QUARTERLY' | 'SEMIANNUAL' | 'ANNUAL' | 'AD_HOC';

const MONTHS: Partial<Record<Frequency, number>> = { MONTHLY: 1, BIMONTHLY: 2, QUARTERLY: 3, SEMIANNUAL: 6, ANNUAL: 12 };
const DAYS: Partial<Record<Frequency, number>> = { WEEKLY: 7, BIWEEKLY: 14 };

export const MAX_OCCURRENCES = 24;

export const toDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
export const toIso = (d: Date) => d.toISOString().slice(0, 10);

/** Today's date in the organisation's time zone. */
export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function addDays(iso: string, days: number): string {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toIso(d);
}

/** Adds calendar months, clamped to the month's end (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(iso: string, months: number): string {
  const d = toDate(iso);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return toIso(target);
}

export const daysBetween = (from: string, to: string) => Math.round((toDate(to).getTime() - toDate(from).getTime()) / 86_400_000);

/**
 * Dates of `count` occurrences from `start`, each computed from the start
 * (not chained) so month-end clamping never drifts. AD_HOC is one occurrence.
 */
export function occurrenceDates(frequency: Frequency, start: string, count: number): string[] {
  const n = frequency === 'AD_HOC' ? 1 : Math.max(1, Math.min(MAX_OCCURRENCES, Math.floor(count)));
  return Array.from({ length: n }, (_, i) => (DAYS[frequency] ? addDays(start, DAYS[frequency]! * i) : addMonths(start, (MONTHS[frequency] ?? 0) * i)));
}
