import { Injectable } from '@nestjs/common';
import { AppConfig } from '../config/app-config.js';
import { LocalDiskStorage } from './local-disk.storage.js';
import type { ObjectStorage } from './storage.js';

/** The configured storage backend. */
@Injectable()
export class StorageService implements ObjectStorage {
  private readonly backend: ObjectStorage;

  constructor(config: AppConfig) {
    this.backend = new LocalDiskStorage(config.storage.path);
  }

  put(key: string, data: Buffer, contentType: string) {
    return this.backend.put(key, data, contentType);
  }

  get(key: string) {
    return this.backend.get(key);
  }

  delete(key: string) {
    return this.backend.delete(key);
  }
}
