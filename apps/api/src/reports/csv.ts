/**
 * CSV for spreadsheets: RFC 4180 quoting, a UTF-8 byte-order mark so Excel
 * reads accents correctly, and formula-safe text (a cell starting with = + -
 * @ or a control character gets a leading apostrophe, so opening an export
 * never runs anything someone typed into a comment).
 */

export const BOM = '\uFEFF';
const FORMULA = /^[=+\-@\t\r]/;

export type Cell = string | number | boolean | Date | null | undefined;

export function csvCell(v: Cell): string {
  if (v == null) return '';
  let s: string;
  if (v instanceof Date) s = v.toISOString();
  else if (typeof v === 'number') s = Number.isFinite(v) ? String(v) : '';
  else if (typeof v === 'boolean') s = v ? 'Yes' : 'No';
  else s = FORMULA.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const csvRow = (cells: Cell[]) => `${cells.map(csvCell).join(',')}\r\n`;
