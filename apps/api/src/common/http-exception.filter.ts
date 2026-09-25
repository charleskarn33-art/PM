import { Catch, HttpException, HttpStatus, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ThrottlerException } from '@nestjs/throttler';
import type { ErrorBody } from './envelope.js';

const CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'VALIDATION_FAILED',
  429: 'TOO_MANY_REQUESTS',
  503: 'SERVICE_UNAVAILABLE',
};

const GENERIC_MESSAGES: Record<number, string> = {
  400: 'The request could not be read. Check that it is valid JSON.',
  401: 'Sign in required.',
  403: 'You do not have permission to do this.',
  404: 'Not found.',
  405: 'This method is not allowed here.',
  413: 'The request body is too large.',
  415: 'This content type is not supported.',
};

const BODY_MESSAGES: Record<string, string> = {
  'entity.too.large': 'The request body is too large.',
  'entity.parse.failed': 'The request body is not valid JSON.',
  'charset.unsupported': 'The request body uses an unsupported character set.',
  'encoding.unsupported': 'The request body uses an unsupported encoding.',
};

/** Errors thrown by Express's body parsers (http-errors with a 4xx status and a type). */
function isBodyParserError(e: unknown): e is { status: number; type: string } {
  if (!e || typeof e !== 'object') return false;
  const { status, type, expose } = e as { status?: unknown; type?: unknown; expose?: unknown };
  return typeof status === 'number' && status >= 400 && status < 500 && typeof type === 'string' && expose === true;
}

/** Error raised by the app with a stable machine-readable code. */
export class AppError extends HttpException {
  constructor(
    status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message, status);
  }
}

/**
 * Every error leaves the API as `{ error: { code, message, details?, requestId } }`.
 * Unexpected errors are logged in full and answered with a generic 500 —
 * internal messages never reach the client.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request & { id?: string }>();
    const res = http.getResponse<Response>();
    const requestId = String(req.id ?? '');

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'An unexpected error occurred.';
    let details: unknown;

    if (exception instanceof AppError) {
      status = exception.getStatus();
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof ThrottlerException) {
      status = HttpStatus.TOO_MANY_REQUESTS;
      code = CODES[status]!;
      message = 'Too many requests. Wait a moment and try again.';
    } else if (isBodyParserError(exception)) {
      // Rejected before reaching a handler (body too large, malformed JSON, …).
      status = exception.status;
      code = CODES[status] ?? `HTTP_${status}`;
      message = BODY_MESSAGES[exception.type] ?? 'The request body could not be read.';
    } else if (exception instanceof HttpException) {
      // Raised by the framework (unknown route, unparsable JSON, …): a fixed
      // message per status. Only AppError messages, written by us, reach clients.
      status = exception.getStatus();
      code = CODES[status] ?? `HTTP_${status}`;
      message = GENERIC_MESSAGES[status] ?? (status >= 500 ? message : 'The request could not be processed.');
    } else {
      this.logger.error({ err: exception, requestId }, 'Unhandled error');
    }

    const body: ErrorBody = { error: { code, message, ...(details === undefined ? {} : { details }), requestId } };
    res.status(status).json(body);
  }
}
