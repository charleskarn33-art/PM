/** Dates as shown on the portal (day month year, 24 h), in the viewer's locale conventions for en-GB. */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(value: string | Date | null | undefined, timeZone?: string): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-GB', { timeZone, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** "Due in 3 days", "Overdue by 2 days" relative to today (YYYY-MM-DD). */
export function dueText(dueDate: string, today: string): string {
  const days = Math.round((Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  if (days > 1) return `Due in ${days} days`;
  return days === -1 ? 'Overdue by 1 day' : `Overdue by ${-days} days`;
}

export const pct = (v: number | null | undefined) => (v == null ? '—' : `${Number.isInteger(v) ? v : v.toFixed(1)}%`);
