import { SyncError } from './sync';

export interface ApiErrorLike {
  message: string;
  code?: string | null;
  status?: number | null;
}

const NETWORK_MESSAGE = /network|fetch|timed? ?out|timeout|abort|connection|socket|offline/i;

/**
 * Decides whether a failed request is worth retrying automatically.
 * Connection problems, timeouts, rate limits, server outages (5xx) and an
 * expired session (401, refreshed automatically) are 'network'. Anything the
 * server answered with a definite refusal (RLS, validation, GPS block,
 * incomplete checklist) is 'rejected' and needs a person.
 */
export function classifyError(e: ApiErrorLike): SyncError {
  const status = e.status ?? 0;
  const message = e.message || 'No connection to the server.';
  // status 0: the request never got an HTTP answer.
  if (status === 0) return new SyncError(!e.message || NETWORK_MESSAGE.test(e.message) ? 'network' : 'rejected', message);
  const transient = status === 401 || status === 408 || status === 429 || status >= 500;
  return new SyncError(transient ? 'network' : 'rejected', message);
}

/** Wraps a thrown value (e.g. fetch TypeError, file read failure) the same way. */
export function classifyThrown(e: unknown): SyncError {
  if (e instanceof SyncError) return e;
  const message = e instanceof Error ? e.message : String(e);
  return classifyError({ message, status: 0 });
}
