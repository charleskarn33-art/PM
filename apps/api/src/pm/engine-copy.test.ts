import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('PM engine copies', () => {
  it('the phone runs exactly the rules the API runs', () => {
    const api = readFileSync(new URL('./engine.ts', import.meta.url), 'utf8');
    const shared = readFileSync(new URL('../../../../packages/shared/src/pm/engine.ts', import.meta.url), 'utf8');
    expect(shared).toBe(api);
  });
});
