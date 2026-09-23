import { isUuid } from '@ipt/shared';

export type AnalyticsTab = 'overview' | 'people' | 'failures' | 'equipment';
export type PeriodPreset = 'month' | '3m' | '12m' | 'ytd' | 'custom';

export const TABS: { id: AnalyticsTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'people', label: 'Technicians & supervisors' },
  { id: 'failures', label: 'Failures' },
  { id: 'equipment', label: 'Equipment' },
];

export const PRESETS: { id: PeriodPreset; label: string }[] = [
  { id: 'month', label: 'This month' },
  { id: '3m', label: 'Last 3 months' },
  { id: '12m', label: 'Last 12 months' },
  { id: 'ytd', label: 'Year to date' },
  { id: 'custom', label: 'Custom range' },
];

export interface AnalyticsParams {
  tab: AnalyticsTab;
  preset: PeriodPreset;
  from: string;
  to: string;
  region: string | null;
  label: string;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

function validDate(v: string): boolean {
  if (!ISO.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/**
 * Period and filters from the URL. Presets are whole calendar months ending
 * with the current one (so month-by-month charts have complete buckets);
 * a custom range must be valid and in order, otherwise "this month" applies.
 */
export function parseAnalyticsParams(sp: Record<string, string | string[] | undefined>, now: Date): AnalyticsParams {
  const tabRaw = first(sp.tab) as AnalyticsTab;
  const tab = TABS.some((t) => t.id === tabRaw) ? tabRaw : 'overview';
  const regionRaw = first(sp.region);
  const region = isUuid(regionRaw) ? regionRaw : null;
  let preset = first(sp.period) as PeriodPreset;
  if (!PRESETS.some((p) => p.id === preset)) preset = 'month';

  const y = now.getFullYear();
  const m = now.getMonth();
  const monthEnd = fmt(new Date(y, m + 1, 0));
  let from = fmt(new Date(y, m, 1));
  let to = monthEnd;
  if (preset === '3m') from = fmt(new Date(y, m - 2, 1));
  if (preset === '12m') from = fmt(new Date(y, m - 11, 1));
  if (preset === 'ytd') from = fmt(new Date(y, 0, 1));
  if (preset === 'custom') {
    const f = first(sp.from);
    const t = first(sp.to);
    if (validDate(f) && validDate(t) && f <= t) {
      from = f;
      to = t;
    } else {
      preset = 'month';
    }
  }
  const label = preset === 'custom' ? `${from} to ${to}` : PRESETS.find((p) => p.id === preset)!.label;
  return { tab, preset, from, to, region, label };
}

/** Months (YYYY-MM) covered by the period, oldest first, so trend charts show empty months too. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const endKey = to.slice(0, 7);
  for (let i = 0; i < 240; i += 1) {
    const key = `${y}-${pad(m)}`;
    out.push(key);
    if (key >= endKey) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** Share as a percentage with one decimal, or null when there is nothing to divide by. */
export function pct(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
}

/** Difference between the highest and lowest phase current relative to their average (%), or null. */
export function phaseImbalancePct(min: number | null, max: number | null, total: number | null, count: number | null): number | null {
  if (min == null || max == null || total == null || !count || count < 2) return null;
  const avg = total / count;
  return avg > 0 ? Math.round(((max - min) / avg) * 1000) / 10 : null;
}
