import { describe, expect, it } from 'vitest';
import { diff, sanitize } from './audit-values.js';

describe('sanitize', () => {
  it('never keeps passwords, tokens or drawn signatures', () => {
    expect(sanitize({ email: 'a@b.c', password: 'hunter2', currentPassword: 'x', newPassword: 'y', refreshToken: 'r', strokes: [[[1, 2]]] })).toEqual({
      email: 'a@b.c',
      password: '[not recorded]',
      currentPassword: '[not recorded]',
      newPassword: '[not recorded]',
      refreshToken: '[not recorded]',
      strokes: '[not recorded]',
    });
    expect(sanitize({ nested: { apiKey: 'k', ok: 1 } })).toEqual({ nested: { apiKey: '[not recorded]', ok: 1 } });
  });

  it('shortens long values', () => {
    expect(sanitize('x'.repeat(400))).toMatch(/^x{300}… \(400 characters\)$/);
    expect(sanitize({ responses: Array.from({ length: 50 }, (_, i) => i) })).toEqual({ responses: '[50 items]' });
    expect(sanitize({ a: { b: { c: { d: { e: 1 } } } } })).toEqual({ a: { b: { c: { d: '[…]' } } } });
    expect(sanitize(new Date('2026-09-28T10:00:00Z'))).toBe('2026-09-28T10:00:00.000Z');
  });
});

describe('diff', () => {
  it('lists changed fields only, without bookkeeping fields', () => {
    const before = { name: 'Alpha', status: 'ACTIVE', updatedAt: new Date(1), latitude: { toString: () => '6.3' } };
    const after = { name: 'Alpha one', status: 'ACTIVE', updatedAt: new Date(2), latitude: { toString: () => '6.3' } };
    expect(diff(before, after)).toEqual({ name: { from: 'Alpha', to: 'Alpha one' } });
    expect(diff(before, before)).toBeNull();
  });

  it('compares dates and JSON by value, and hides secret fields', () => {
    expect(diff({ due: new Date('2026-09-01T00:00:00Z'), options: ['a'] }, { due: new Date('2026-09-02T00:00:00Z'), options: ['a'] })).toEqual({
      due: { from: '2026-09-01T00:00:00.000Z', to: '2026-09-02T00:00:00.000Z' },
    });
    expect(diff({ passwordHash: 'old' }, { passwordHash: 'new' })).toEqual({ passwordHash: { from: '[not recorded]', to: '[changed]' } });
  });

  it('records what a record was when it disappears', () => {
    expect(diff({ code: 'GEN', name: 'Generator' }, null)).toEqual({ code: { from: 'GEN', to: null }, name: { from: 'Generator', to: null } });
  });
});
