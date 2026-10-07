/**
 * How values go into the audit log: secrets never, long values shortened,
 * and changes as `{ field: { from, to } }`.
 */

/** Keys never written to the log (passwords, tokens, secrets, drawn signatures). */
const SECRET_KEY = /password|passcode|token|secret|hash|strokes|otp|api[-_]?key|authorization|cookie/i;
/** Named like a secret but only a flag. */
const NOT_SECRET = new Set(['mustChangePassword']);
const SECRET = { test: (k: string) => SECRET_KEY.test(k) && !NOT_SECRET.has(k) };
/** Bookkeeping fields left out of field-level changes. */
const IGNORED = new Set(['updatedAt', 'updatedById', 'createdAt', 'createdById', 'passwordChangedAt', 'lastLoginAt', 'pushClaim', 'pushClaimedAt']);

const MAX_STRING = 300;
const MAX_ARRAY = 20;
const MAX_KEYS = 60;
const MAX_DEPTH = 4;

/** A copy safe to store: secret keys replaced, long strings, arrays and objects shortened. */
export function sanitize(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}… (${value.length} characters)` : value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (depth >= MAX_DEPTH) return '[…]';
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY) return `[${value.length} items]`;
    return value.map((v) => sanitize(v, depth + 1));
  }
  if (typeof value === 'object') {
    // Decimal and similar: their text form.
    if (!isPlain(value)) return String(value);
    const out: Record<string, unknown> = {};
    const entries = Object.entries(value as Record<string, unknown>);
    for (const [k, v] of entries.slice(0, MAX_KEYS)) out[k] = SECRET.test(k) ? '[not recorded]' : sanitize(v, depth + 1);
    if (entries.length > MAX_KEYS) out['…'] = `${entries.length - MAX_KEYS} more fields`;
    return out;
  }
  return String(value);
}

const isPlain = (v: object) => {
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

/** Comparable form of a stored value. */
function norm(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (v != null && typeof v === 'object' && !Array.isArray(v) && !isPlain(v)) return String(v); // Decimal
  return v;
}

/**
 * Fields that differ between two versions of a record (secrets shown only as
 * "changed"). Null when nothing differs or a version is missing.
 */
export function diff(before: Record<string, unknown> | null, after: Record<string, unknown> | null): Record<string, { from: unknown; to: unknown }> | null {
  if (!before && !after) return null;
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of keys) {
    if (IGNORED.has(k)) continue;
    const from = norm(before?.[k] ?? null);
    const to = norm(after?.[k] ?? null);
    if (JSON.stringify(from) === JSON.stringify(to)) continue;
    out[k] = SECRET.test(k) ? { from: '[not recorded]', to: '[changed]' } : { from: sanitize(from), to: sanitize(to) };
  }
  return Object.keys(out).length ? out : null;
}
