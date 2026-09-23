import { DatabaseSync } from 'node:sqlite';
import type { LocalDb, SqlParam } from '../db';

/** node:sqlite implementation of LocalDb, so tests run on a real SQL engine. */
export class NodeDb implements LocalDb {
  private readonly db = new DatabaseSync(':memory:');
  async exec(sql: string) {
    this.db.exec(sql);
  }
  async run(sql: string, params: SqlParam[] = []) {
    const r = this.db.prepare(sql).run(...params);
    return { changes: Number(r.changes) };
  }
  async all<T>(sql: string, params: SqlParam[] = []) {
    return this.db.prepare(sql).all(...params) as T[];
  }
  async first<T>(sql: string, params: SqlParam[] = []) {
    return (this.db.prepare(sql).get(...params) as T | undefined) ?? null;
  }
  async transaction(fn: () => Promise<void>) {
    this.db.exec('begin');
    try {
      await fn();
      this.db.exec('commit');
    } catch (e) {
      this.db.exec('rollback');
      throw e;
    }
  }
}
