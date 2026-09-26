import { WithMeta } from './envelope.js';

/** `{ items, total, page, pageSize }` → `{ data: items, meta: { total, page, pageSize } }`. */
export function paged<T>(r: { items: T[]; total: number; page: number; pageSize: number }): WithMeta<T[]> {
  return new WithMeta(r.items, { total: r.total, page: r.page, pageSize: r.pageSize });
}
