/**
 * The little SQL the offline store needs, so the store runs on the phone
 * (expo-sqlite) and in unit tests (Node's built-in SQLite) alike.
 */
export type SqlValue = string | number | null;

export interface SqlDb {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlValue[]): Promise<{ lastInsertRowId: number; changes: number }>;
  all<T>(sql: string, params?: SqlValue[]): Promise<T[]>;
}

/** Runs tasks one at a time (a transaction must not interleave with other statements). */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.tail.then(task, task);
    this.tail = next.catch(() => undefined);
    return next;
  }
}
