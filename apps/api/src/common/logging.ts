import type { IncomingMessage } from 'node:http';

/** Path only: query strings can carry signed-URL tokens and must not be logged. */
export const pathOf = (url: string | undefined): string => (url ?? '').split('?')[0] ?? '';

/**
 * What a request log line contains: id, method, path, status (+ user id and
 * duration added by pino-http). Headers — and with them Authorization and
 * cookies — and bodies are never serialised.
 */
export const logSerializers = {
  req: (req: IncomingMessage & { id?: string }) => ({ id: req.id, method: req.method, path: pathOf(req.url) }),
  res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
};

/** Defence in depth if a header is ever logged explicitly. */
export const logRedactPaths = ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'];
