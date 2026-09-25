import { Injectable, StreamableFile, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { map, type Observable } from 'rxjs';
import { WithMeta, type SuccessBody } from './envelope.js';

/** Wraps every handler result as `{ data }` (or `{ data, meta }`); files pass through. */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((value): unknown => {
        if (value instanceof StreamableFile) return value;
        if (value instanceof WithMeta) return { data: value.data, meta: value.meta } satisfies SuccessBody<unknown>;
        return { data: value ?? null } satisfies SuccessBody<unknown>;
      }),
    );
  }
}
