import 'server-only';
import { revalidatePath } from 'next/cache';
import { ApiError } from './api/client';
import { formValues, type FormValues } from './form-values';

export interface FormState {
  error?: string;
  success?: string;
  /** Problems per field (from the API's validation details). */
  fieldErrors?: Record<string, string>;
  /** What was submitted, so the form keeps the user's input after an error. */
  values?: FormValues;
}

/** The API's field problems (`details: [{ path, message }]`) keyed by their first path segment. */
export function fieldErrorsOf(e: ApiError): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(e.details)) {
    for (const d of e.details as { path?: string; message?: string }[]) {
      const key = (d.path ?? '').split('.')[0] || '_';
      if (d.message && !out[key]) out[key] = d.message;
    }
  }
  return out;
}

/** A message for the user: the API's own for refusals (written for users), a generic one otherwise. */
export function messageOf(e: unknown): string {
  if (e instanceof ApiError && e.status < 500) return e.message;
  if (e instanceof ApiError && e.code === 'API_UNAVAILABLE') return e.message;
  return 'Something went wrong. Try again in a moment.';
}

/**
 * Runs an API change for a form: success message and revalidation, or the
 * API's error with field problems and the submitted values.
 */
export async function submit(formData: FormData, call: () => Promise<unknown>, success: string, revalidate: readonly string[] = []): Promise<FormState> {
  try {
    await call();
  } catch (e) {
    if (!(e instanceof ApiError) || e.status >= 500) console.error('form action failed', e instanceof ApiError ? { status: e.status, code: e.code } : e);
    return { error: messageOf(e), fieldErrors: e instanceof ApiError ? fieldErrorsOf(e) : undefined, values: formValues(formData) };
  }
  for (const p of revalidate) revalidatePath(p);
  return { success };
}

/** A trimmed text field; empty → undefined (or null with `nullIfEmpty`). */
export function text(formData: FormData, key: string): string | undefined;
export function text(formData: FormData, key: string, nullIfEmpty: true): string | null;
export function text(formData: FormData, key: string, nullIfEmpty = false): string | null | undefined {
  const v = String(formData.get(key) ?? '').trim();
  return v ? v : nullIfEmpty ? null : undefined;
}
