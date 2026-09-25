import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;

/**
 * Request ID for logs and error bodies: a well-formed `X-Request-Id` from the
 * caller (e.g. nginx) is kept so a request can be traced end to end;
 * anything else is replaced. Echoed back in the response header.
 */
export function requestId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers['x-request-id'];
  const id = typeof incoming === 'string' && SAFE_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', id);
  return id;
}
