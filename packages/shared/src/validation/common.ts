export type FieldErrors<K extends string = string> = Partial<Record<K, string>>;

export type ValidationResult<T, K extends string = string> =
  | { ok: true; value: T }
  | { ok: false; errors: FieldErrors<K> };

export type RawInput = Record<string, string | null | undefined>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function text(raw: RawInput, key: string): string {
  return (raw[key] ?? '').trim();
}

/** Empty -> null; otherwise the trimmed string. */
export function optionalText(raw: RawInput, key: string): string | null {
  const v = text(raw, key);
  return v === '' ? null : v;
}

/** HTML checkbox semantics: "on" / "true" / "1" are true, anything else false. */
export function checkbox(raw: RawInput, key: string): boolean {
  return ['on', 'true', '1'].includes(text(raw, key).toLowerCase());
}

/** Parses an optional number; returns undefined when present but invalid. */
export function optionalNumber(raw: RawInput, key: string): number | null | undefined {
  const v = text(raw, key);
  if (v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
