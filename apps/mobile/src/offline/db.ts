/**
 * Minimal async SQLite interface. Implemented by expo-sqlite on the device
 * (expo-db.ts) and by node:sqlite in unit tests, so the offline store and sync
 * engine are tested against a real SQL engine.
 */
export type SqlParam = string | number | null;

export interface LocalDb {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlParam[]): Promise<{ changes: number }>;
  all<T>(sql: string, params?: SqlParam[]): Promise<T[]>;
  first<T>(sql: string, params?: SqlParam[]): Promise<T | null>;
  transaction(fn: () => Promise<void>): Promise<void>;
}

/**
 * Local schema. A row has unsent changes exactly when an outbox operation
 * exists for it (keyed like 'response:<visit>:<item>'), so no separate sync
 * flag can disagree with the queue.
 * Bump SCHEMA_VERSION and append a step to change it. */
export const SCHEMA_VERSION = 2;

const STEPS: Record<number, string> = {
  1: `
    create table if not exists documents (
      key text primary key,
      json text not null,
      updated_at text not null
    );
    create table if not exists visits (
      id text primary key,
      json text not null,
      updated_at text not null
    );
    create table if not exists responses (
      visit_id text not null,
      item_id text not null,
      json text not null,
      primary key (visit_id, item_id)
    );
    create table if not exists readings (
      visit_id text not null,
      field_id text not null,
      json text not null,
      primary key (visit_id, field_id)
    );
    create table if not exists photos (
      id text primary key,
      visit_id text not null,
      item_id text,
      local_uri text,
      thumb_uri text,
      json text not null,
      created_at text not null
    );
    create index if not exists photos_visit_idx on photos (visit_id);
    create table if not exists outbox (
      seq integer primary key autoincrement,
      key text not null unique,
      kind text not null,
      visit_id text,
      payload text not null,
      state text not null default 'PENDING',
      version integer not null default 1,
      attempts integer not null default 0,
      last_error text,
      next_attempt_at text,
      created_at text not null,
      updated_at text not null
    );
  `,
  // Phase 6: corrective actions assigned to the user, and their notifications.
  2: `
    create table if not exists actions (
      id text primary key,
      json text not null
    );
    create table if not exists notifications (
      id text primary key,
      json text not null,
      created_at text not null
    );
  `,
};

export async function migrate(db: LocalDb): Promise<void> {
  const row = await db.first<{ user_version: number }>('pragma user_version');
  const current = row?.user_version ?? 0;
  for (let v = current + 1; v <= SCHEMA_VERSION; v += 1) {
    await db.exec(STEPS[v]!);
    await db.exec(`pragma user_version = ${v}`);
  }
}
