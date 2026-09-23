import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { migrate, type LocalDb, type SqlParam } from './db';

class ExpoLocalDb implements LocalDb {
  constructor(private readonly db: SQLiteDatabase) {}
  exec(sql: string) {
    return this.db.execAsync(sql);
  }
  async run(sql: string, params: SqlParam[] = []) {
    const r = await this.db.runAsync(sql, params);
    return { changes: r.changes };
  }
  all<T>(sql: string, params: SqlParam[] = []) {
    return this.db.getAllAsync<T>(sql, params);
  }
  first<T>(sql: string, params: SqlParam[] = []) {
    return this.db.getFirstAsync<T>(sql, params);
  }
  transaction(fn: () => Promise<void>) {
    return this.db.withTransactionAsync(fn);
  }
}

let opened: Promise<LocalDb> | null = null;

/** The app's single local database (opened once, migrated on first use). */
export function openLocalDb(): Promise<LocalDb> {
  opened ??= (async () => {
    const raw = await openDatabaseAsync('ipt-pm.db');
    await raw.execAsync('pragma journal_mode = wal;');
    const db = new ExpoLocalDb(raw);
    await migrate(db);
    return db;
  })();
  return opened;
}
