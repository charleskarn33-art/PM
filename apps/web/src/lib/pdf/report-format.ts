/**
 * Pure formatting helpers for printed reports (unit-tested). PDF standard
 * fonts only cover Latin-1, so text is normalised to characters they can
 * print instead of silently dropping symbols.
 */
const REPLACEMENTS: [RegExp, string][] = [
  [/[‘’]/g, "'"],
  [/[“”]/g, '"'],
  [/≤/g, '<='],
  [/≥/g, '>='],
  [/→/g, '->'],
  [/…/g, '...'],
  [/–/g, '-'],
];

export function printable(text: string | null | undefined): string {
  if (text == null) return '';
  let out = String(text);
  for (const [re, to] of REPLACEMENTS) out = out.replace(re, to);
  // Keep Latin-1 and the em dash / bullet the standard fonts include; replace the rest.
  return out.replace(/[^\u0009\u000A\u000D -ÿ—•]/g, '?');
}

export function formatDateTime(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
}

export function formatNumber(v: number | null | undefined, unit?: string | null, digits = 2): string {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Number(Number(v).toFixed(digits));
  return `${n.toLocaleString('en-GB')}${unit ? ` ${unit}` : ''}`;
}

/** File name like PM-1301-Tienii-2026-09-15.pdf (safe characters only). */
export function reportFileName(siteCode: string, siteName: string, date: string | null | undefined): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `PM-${safe(siteCode)}-${safe(siteName)}-${(date ?? '').slice(0, 10) || 'draft'}.pdf`.replace(/-+/g, '-');
}
