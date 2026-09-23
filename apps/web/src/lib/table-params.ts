export type SearchParams = Record<string, string | string[] | undefined>;

export interface TableConfig<S extends string> {
  sortable: readonly S[];
  defaultSort: S;
  defaultDir?: 'asc' | 'desc';
  /** Filter keys read from the query string. */
  filters?: readonly string[];
}

export interface TableParams<S extends string> {
  page: number;
  pageSize: number;
  sort: S;
  dir: 'asc' | 'desc';
  q: string;
  filters: Record<string, string>;
  hidden: Set<string>;
}

export const PAGE_SIZES = [25, 50, 100] as const;

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? '';
}

/** Parses and whitelists table state from URL search params. */
export function parseTableParams<S extends string>(sp: SearchParams, config: TableConfig<S>): TableParams<S> {
  const page = Math.max(1, Number.parseInt(first(sp.page), 10) || 1);
  const size = Number.parseInt(first(sp.size), 10);
  const pageSize = (PAGE_SIZES as readonly number[]).includes(size) ? size : PAGE_SIZES[0];
  const sortRaw = first(sp.sort) as S;
  const sort = config.sortable.includes(sortRaw) ? sortRaw : config.defaultSort;
  const dirRaw = first(sp.dir);
  const dir = dirRaw === 'asc' || dirRaw === 'desc' ? dirRaw : (config.defaultDir ?? 'asc');
  const filters: Record<string, string> = {};
  for (const key of config.filters ?? []) {
    const v = first(sp[key]);
    if (v) filters[key] = v;
  }
  const hidden = new Set(first(sp.hide).split(',').filter(Boolean));
  // Limit free text to a sane length; PostgREST filter syntax chars are escaped by callers.
  return { page, pageSize, sort, dir, q: first(sp.q).slice(0, 100), filters, hidden };
}

/** Builds a URL for the same table with some params changed (null removes a param). */
export function tableHref(
  pathname: string,
  current: SearchParams,
  changes: Record<string, string | number | null>,
): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) {
    const value = first(v);
    if (value) params.set(k, value);
  }
  for (const [k, v] of Object.entries(changes)) {
    if (v === null || v === '') params.delete(k);
    else params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/**
 * Escapes user text for use inside a PostgREST `or=(...ilike...)` filter:
 * strips characters with meaning in the filter grammar and escapes LIKE wildcards.
 */
export function toIlikePattern(q: string): string {
  const cleaned = q.replace(/[(),"'\\]/g, ' ').replace(/[%_]/g, (m) => `\\${m}`).trim();
  return `%${cleaned}%`;
}

export function pageRange(page: number, pageSize: number): { from: number; to: number } {
  const from = (page - 1) * pageSize;
  return { from, to: from + pageSize - 1 };
}

/**
 * PostgREST answers a counted query whose offset is past the last row with
 * PGRST103 (416) instead of an empty page, e.g. after filters shrink a list
 * or on an old link. Lists go back to their first page; exports stop paging.
 */
export function isBeyondLastPage(error: { code?: string } | null | undefined): boolean {
  return error?.code === 'PGRST103';
}
