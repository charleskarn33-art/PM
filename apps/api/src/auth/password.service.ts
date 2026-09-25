import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';

/**
 * Argon2id password hashing (OWASP baseline: 19 MiB memory, 2 iterations,
 * 1 lane). Only hashes are stored; plaintext passwords are never kept or logged.
 */
@Injectable()
export class PasswordService {
  private readonly options = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

  hash(password: string): Promise<string> {
    return argon2.hash(password, this.options);
  }

  /** False for a wrong password or a malformed hash — never throws on bad input. */
  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  /** True when a stored hash uses weaker parameters than the current ones. */
  needsRehash(hash: string): boolean {
    return argon2.needsRehash(hash, this.options);
  }
}
