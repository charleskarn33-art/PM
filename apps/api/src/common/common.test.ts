import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError } from './http-exception.filter.js';
import { logSerializers, pathOf } from './logging.js';
import { requestId } from './request-id.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

describe('request ids', () => {
  const res = () => {
    const headers: Record<string, string> = {};
    return { headers, setHeader: (k: string, v: string) => (headers[k] = v) };
  };
  it('keeps a well-formed incoming id and echoes it', () => {
    const r = res();
    expect(requestId({ headers: { 'x-request-id': 'nginx-abc123def' } } as never, r as never)).toBe('nginx-abc123def');
    expect(r.headers['X-Request-Id']).toBe('nginx-abc123def');
  });
  it('replaces missing or unsafe ids', () => {
    for (const bad of [undefined, 'short', 'has spaces in it', 'x'.repeat(65), '<script>alert(1)</script>']) {
      const id = requestId({ headers: { 'x-request-id': bad } } as never, res() as never);
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    }
  });
});

describe('logging', () => {
  it('logs method and path only — no headers, no query string', () => {
    const line = logSerializers.req({
      id: 'r1',
      method: 'GET',
      url: '/api/v1/files/x?signature=secret-token',
      headers: { authorization: 'Bearer secret', cookie: 'a=b' },
    } as never);
    expect(line).toEqual({ id: 'r1', method: 'GET', path: '/api/v1/files/x' });
    expect(JSON.stringify(line)).not.toMatch(/secret|Bearer|cookie/);
    expect(pathOf(undefined)).toBe('');
  });
});

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(z.strictObject({ fuelLevelPct: z.number().min(0).max(100) }));
  it('returns valid input unchanged', () => {
    expect(pipe.transform({ fuelLevelPct: 12.7 })).toEqual({ fuelLevelPct: 12.7 });
  });
  it('rejects wrong types, out-of-range values and unknown fields with 422 details (no coercion)', () => {
    for (const bad of [{ fuelLevelPct: '12.7' }, { fuelLevelPct: 101 }, { fuelLevelPct: 5, extra: true }]) {
      try {
        pipe.transform(bad);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(AppError);
        expect((e as AppError).getStatus()).toBe(422);
        expect((e as AppError).code).toBe('VALIDATION_FAILED');
        expect(Array.isArray((e as AppError).details)).toBe(true);
      }
    }
  });
});
