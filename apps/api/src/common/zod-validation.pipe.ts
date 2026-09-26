import { Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { parseInput } from './validation.js';

/**
 * Validates a body / query / param against a zod schema. Invalid input is
 * rejected with 422 and a list of field problems; nothing is coerced silently.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    return parseInput(this.schema, value);
  }
}
