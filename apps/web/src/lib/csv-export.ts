import 'server-only';
import { toCsv, toIsoDate, type CsvColumn, type Database } from '@ipt/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { isBeyondLastPage } from '@/lib/table-params';

type Client = SupabaseClient<Database>;

/** Upper bound for one export; PostgREST returns at most 1,000 rows per request, so exports page through. */
export const MAX_EXPORT_ROWS = 10_000;
const PAGE = 1000;

/** Fetches every row of a query page by page (`fetchPage(from, to)`), up to MAX_EXPORT_ROWS. */
export async function fetchAll<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string; code?: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < MAX_EXPORT_ROWS; from += PAGE) {
    const { data, error } = await fetchPage(from, Math.min(from + PAGE, MAX_EXPORT_ROWS) - 1);
    if (isBeyondLastPage(error)) break; // the previous page ended exactly on the last row
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

/** Excel-compatible CSV download; every export is recorded in the audit log. */
export async function csvResponse<T>(
  supabase: Client,
  report: string,
  filters: Record<string, string>,
  rows: readonly T[],
  columns: readonly CsvColumn<T>[],
): Promise<NextResponse> {
  const { error } = await supabase.rpc('record_report_generated', { p_report: report, p_filters: filters, p_row_count: rows.length });
  if (error) console.error('record_report_generated failed', error.message);
  return new NextResponse(toCsv(rows, columns), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${report.replace(/_csv$/, '').replace(/_/g, '-')}-${toIsoDate(new Date())}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}

export function exportError(message: string): NextResponse {
  return NextResponse.json({ error: `Export failed: ${message}` }, { status: 500 });
}
