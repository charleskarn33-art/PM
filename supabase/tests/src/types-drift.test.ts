import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SUPABASE_DIR, testDbUrl } from './db';

describe('generated TypeScript types', () => {
  it('packages/shared/src/database.types.ts matches the migrated schema', () => {
    const script = join(SUPABASE_DIR, '..', 'scripts', 'gen-db-types.mjs');
    const run = () =>
      execFileSync(process.execPath, [script, '--check', '--db-url', testDbUrl()], { encoding: 'utf8' });
    expect(run).not.toThrow();
  });
});
