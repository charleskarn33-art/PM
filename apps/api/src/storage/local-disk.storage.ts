import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { assertValidKey, StorageNotFoundError, type ObjectStorage } from './storage.js';

/**
 * Files under STORAGE_PATH on the server's disk (a Docker volume in
 * production). Writes go to a temporary file first and are renamed into
 * place, so a crash never leaves a half-written file under a real key.
 */
export class LocalDiskStorage implements ObjectStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private pathOf(key: string): string {
    assertValidKey(key);
    const full = resolve(this.root, key);
    if (!full.startsWith(this.root + sep)) throw new Error(`Invalid storage key: ${key}`);
    return full;
  }

  async put(key: string, data: Buffer, _contentType?: string): Promise<void> {
    const full = this.pathOf(key);
    await mkdir(dirname(full), { recursive: true, mode: 0o750 });
    const tmp = `${full}.${randomUUID()}.tmp`;
    await writeFile(tmp, data, { mode: 0o640 });
    await rename(tmp, full);
  }

  async get(key: string): Promise<Buffer> {
    try {
      return await readFile(this.pathOf(key));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new StorageNotFoundError(key);
      throw e;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathOf(key), { force: true });
  }
}
