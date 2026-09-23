import { describe, expect, it } from 'vitest';
import { classifyError, classifyThrown } from './errors';
import { SyncError } from './sync';

describe('classifyError', () => {
  it('retries connection problems, outages, rate limits and expired sessions', () => {
    for (const e of [
      { message: 'TypeError: Network request failed', status: 0 },
      { message: '', status: 0 },
      { message: 'Service Unavailable', status: 503 },
      { message: 'Too many requests', status: 429 },
      { message: 'JWT expired', status: 401, code: 'PGRST301' },
    ]) {
      expect(classifyError(e).kind).toBe('network');
    }
  });
  it('treats definite server refusals as rejected', () => {
    for (const e of [
      { message: 'new row violates row-level security policy', status: 403, code: '42501' },
      { message: 'Technician is outside the configured site radius. PM cannot be started here.', status: 403 },
      { message: 'PM cannot be submitted: 3 required items', status: 400, code: '23514' },
      { message: 'File not found', status: 0 },
    ]) {
      expect(classifyError(e).kind).toBe('rejected');
    }
  });
  it('wraps thrown values', () => {
    expect(classifyThrown(new TypeError('Network request failed')).kind).toBe('network');
    const own = new SyncError('rejected', 'x');
    expect(classifyThrown(own)).toBe(own);
  });
});
