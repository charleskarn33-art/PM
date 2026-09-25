/** Success body of every JSON response: `{ data, meta? }`. */
export interface SuccessBody<T> {
  data: T;
  meta?: Record<string, unknown>;
}

/** Error body of every error response. */
export interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId: string;
  };
}

/** Return from a handler to add `meta` (e.g. pagination) next to `data`. */
export class WithMeta<T> {
  constructor(
    readonly data: T,
    readonly meta: Record<string, unknown>,
  ) {}
}
