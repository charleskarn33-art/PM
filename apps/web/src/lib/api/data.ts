import 'server-only';
import { notFound } from 'next/navigation';
import { ApiError } from './client';
import { api } from './server';

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** A query string from the values that are set (empty values are left out). */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** One record; "not found" (or out of the user's scope) shows the 404 page. */
export async function load<T>(path: string): Promise<T> {
  try {
    return (await api<T>(path)).data;
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 422)) notFound();
    throw e;
  }
}

/** A record the user may not be allowed to see: null instead of an error. */
export async function loadOptional<T>(path: string): Promise<T | null> {
  try {
    return (await api<T>(path)).data;
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) return null;
    throw e;
  }
}

/** A page of a list (`meta` from the API envelope). */
export async function loadPage<T>(path: string): Promise<Page<T>> {
  const r = await api<T[]>(path);
  const m = r.meta as { total?: number; page?: number; pageSize?: number } | undefined;
  return { items: r.data, total: m?.total ?? r.data.length, page: m?.page ?? 1, pageSize: m?.pageSize ?? r.data.length };
}

/** Every item of a list the API pages (at most `limit`, for select options). */
export async function loadAll<T>(path: string, limit = 500): Promise<T[]> {
  const out: T[] = [];
  const sep = path.includes('?') ? '&' : '?';
  for (let page = 1; out.length < limit; page++) {
    const r = await loadPage<T>(`${path}${sep}page=${page}&pageSize=100`);
    out.push(...r.items);
    if (out.length >= r.total || r.items.length === 0) break;
  }
  return out.slice(0, limit);
}
