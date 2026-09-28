/**
 * Pure helpers for analytics: month ranges in the organisation's time zone,
 * rates and averages, and threshold flags. A flag is raised only against a
 * threshold an administrator configured; an empty threshold flags nothing.
 */

export const MAX_MONTHS = 24;
export const DEFAULT_MONTHS = 6;

export type Month = string; // YYYY-MM

/** The calendar month of an instant in a time zone. */
export function monthIn(timeZone: string, at: Date): Month {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).format(at).slice(0, 7);
}

export function addMonth(month: Month, n: number): Month {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** Months from `from` to `to` inclusive. */
export function monthsBetween(from: Month, to: Month): Month[] {
  const out: Month[] = [];
  for (let m = from; m <= to; m = addMonth(m, 1)) out.push(m);
  return out;
}

export class AnalyticsRangeError extends Error {}

/**
 * The months to report: `to` defaults to the current month, `from` to
 * DEFAULT_MONTHS back from `to`. At most MAX_MONTHS.
 */
export function resolveRange(input: { from?: Month; to?: Month }, currentMonth: Month): { from: Month; to: Month; months: Month[] } {
  const to = input.to ?? currentMonth;
  const from = input.from ?? addMonth(to, -(DEFAULT_MONTHS - 1));
  if (from > to) throw new AnalyticsRangeError('“from” must not be after “to”.');
  const months = monthsBetween(from, to);
  if (months.length > MAX_MONTHS) throw new AnalyticsRangeError(`At most ${MAX_MONTHS} months can be reported at once.`);
  return { from, to, months };
}

/** A percentage to one decimal place; null when there is nothing to divide by. */
export const pct = (n: number, d: number): number | null => (d ? Math.round((1000 * n) / d) / 10 : null);

/** Mean of the known values (to 3 decimals); null when none are known. */
export function mean(values: (number | null | undefined)[]): number | null {
  const known = values.filter((v): v is number => v != null && Number.isFinite(v));
  return known.length ? Math.round((1000 * known.reduce((a, b) => a + b, 0)) / known.length) / 1000 : null;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : Math.round(((s[mid - 1]! + s[mid]!) / 2) * 1000) / 1000;
}

export const num = (d: { toString(): string } | number | null | undefined): number | null => (d == null ? null : Number(d));

export interface Thresholds {
  dcLoadKwMax: number | null;
  rectifierVoltageMin: number | null;
  batteryVoltageMin: number | null;
  batteryUnitVoltageMin: number | null;
  fuelLevelMinPct: number | null;
  generatorServiceHours: number | null;
  completionTargetPct: number | null;
}

export type PowerFlag = 'DC_LOAD_HIGH' | 'RECTIFIER_VOLTAGE_LOW' | 'BATTERY_VOLTAGE_LOW' | 'BATTERY_UNIT_LOW' | 'FUEL_LOW' | 'SERVICE_HOURS_REACHED';

const above = (v: number | null, max: number | null) => v != null && max != null && v > max;
const below = (v: number | null, min: number | null) => v != null && min != null && v < min;

export function dcFlags(r: { dcPowerKw: number | null; rectifierVoltageV: number | null }, t: Thresholds): PowerFlag[] {
  const out: PowerFlag[] = [];
  if (above(r.dcPowerKw, t.dcLoadKwMax)) out.push('DC_LOAD_HIGH');
  if (below(r.rectifierVoltageV, t.rectifierVoltageMin)) out.push('RECTIFIER_VOLTAGE_LOW');
  return out;
}

export function batteryFlags(r: { batteryVoltageV: number | null; minUnitVoltageV: number | null }, t: Thresholds): PowerFlag[] {
  const out: PowerFlag[] = [];
  if (below(r.batteryVoltageV, t.batteryVoltageMin)) out.push('BATTERY_VOLTAGE_LOW');
  if (below(r.minUnitVoltageV, t.batteryUnitVoltageMin)) out.push('BATTERY_UNIT_LOW');
  return out;
}

export function generatorFlags(r: { fuelLevelPct: number | null; runningHours: number | null }, t: Thresholds): PowerFlag[] {
  const out: PowerFlag[] = [];
  if (below(r.fuelLevelPct, t.fuelLevelMinPct)) out.push('FUEL_LOW');
  if (r.runningHours != null && t.generatorServiceHours != null && r.runningHours >= t.generatorServiceHours) out.push('SERVICE_HOURS_REACHED');
  return out;
}

/** True/false against the completion target; null when no target is configured or nothing was due. */
export const belowTarget = (ratePct: number | null, t: Thresholds): boolean | null =>
  ratePct == null || t.completionTargetPct == null ? null : ratePct < t.completionTargetPct;
