import { ApiError } from './session-client';

/** A user-facing message for an API error. */
export function errorMessage(e: unknown, action = 'load this'): string {
  if (e instanceof ApiError) {
    if (e.offline) return `No connection. Connect to ${action}.`;
    if (e.status < 500) return e.message;
  }
  return `Unable to ${action} right now. Try again in a moment.`;
}
