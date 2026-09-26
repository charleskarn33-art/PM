import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalDiskStorage } from './local-disk.storage.js';
import { StorageNotFoundError } from './storage.js';

let dir: string;
let storage: LocalDiskStorage;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ipt-storage-'));
  storage = new LocalDiskStorage(dir);
});
afterAll(() => rm(dir, { recursive: true, force: true }));

describe('LocalDiskStorage', () => {
  it('stores, reads and deletes by key, leaving no temporary files', async () => {
    await storage.put('pm/visits/v1/p1.jpg', Buffer.from('image-bytes'), 'image/jpeg');
    expect((await storage.get('pm/visits/v1/p1.jpg')).toString()).toBe('image-bytes');
    expect(await readdir(join(dir, 'pm/visits/v1'))).toEqual(['p1.jpg']);
    await storage.delete('pm/visits/v1/p1.jpg');
    await expect(storage.get('pm/visits/v1/p1.jpg')).rejects.toBeInstanceOf(StorageNotFoundError);
    await storage.delete('pm/visits/v1/p1.jpg'); // idempotent
  });

  it('refuses keys that could leave the storage directory', async () => {
    for (const key of ['../etc/passwd', '/abs/path', 'pm/../../x', 'PM/Upper', 'pm//double', '']) {
      await expect(storage.put(key, Buffer.from('x'), 'text/plain')).rejects.toThrow(/Invalid storage key/);
    }
  });
});
