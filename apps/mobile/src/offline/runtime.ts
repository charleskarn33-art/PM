/** The phone side of the offline store: expo-sqlite, photo files and the API session. */
import { File } from 'expo-file-system';
import * as SQLite from 'expo-sqlite';
import { sessionClient } from '@/lib/api/session';
import { ApiError } from '@/lib/api/session-client';
import type { SqlDb } from './sql';
import { migrate, OfflineStore } from './store';
import { SyncEngine } from './sync';
import type { PhotoPayload } from './visit-ops';

let opening: Promise<SqlDb> | null = null;

/** The app's database (in the app's private storage; opened and upgraded once). */
export function fieldDb(): Promise<SqlDb> {
  opening ??= (async () => {
    const db = await SQLite.openDatabaseAsync('ipt-field.db');
    await db.execAsync('PRAGMA journal_mode = WAL;');
    const sql: SqlDb = {
      exec: (s) => db.execAsync(s),
      run: async (s, params = []) => {
        const r = await db.runAsync(s, params);
        return { lastInsertRowId: r.lastInsertRowId, changes: r.changes };
      },
      all: (s, params = []) => db.getAllAsync(s, params),
    };
    await migrate(sql);
    return sql;
  })();
  opening.catch(() => {
    opening = null;
  });
  return opening;
}

/** Removes a photo taken on the phone (and its thumbnail) once it is no longer needed. */
export function deletePhotoFile(uri: string): void {
  for (const u of [uri, uri.replace(/\.jpg$/, '_thumb.jpg')]) {
    try {
      const f = new File(u);
      if (f.exists) f.delete();
    } catch {
      // Leaving the file is harmless; it is in the app's own folder.
    }
  }
}

function photoForm(p: PhotoPayload): FormData {
  if (!new File(p.localUri).exists) {
    throw new ApiError(0, 'FILE_MISSING', 'The photo is no longer on this phone. Discard it and take it again.');
  }
  const form = new FormData();
  form.append('id', p.id);
  if (p.checklistItemId) form.append('checklistItemId', p.checklistItemId);
  if (p.caption) form.append('caption', p.caption.slice(0, 255));
  form.append('takenAt', p.takenAt);
  // React Native's FormData takes a file as { uri, name, type }.
  form.append('file', { uri: p.localUri, name: `${p.id}.jpg`, type: 'image/jpeg' } as unknown as Blob);
  return form;
}

export async function openOffline(userId: string): Promise<{ store: OfflineStore; engine: SyncEngine } | null> {
  if (!sessionClient) return null;
  const store = new OfflineStore(await fieldDb(), userId);
  const engine = new SyncEngine({ store, api: sessionClient, photoForm, deleteFile: deletePhotoFile });
  return { store, engine };
}
