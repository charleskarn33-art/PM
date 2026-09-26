import { HttpStatus } from '@nestjs/common';
import type { ZodType } from 'zod';
import { AppError } from './http-exception.filter.js';

/** Field problems from a zod error, for the `details` of a 422. */
export const zodDetails = (issues: readonly { path: readonly PropertyKey[]; message: string }[]) =>
  issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message }));

/** Validates input against a schema; invalid input becomes a 422 with field details. */
export function parseInput<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_FAILED', 'The request contains invalid values.', zodDetails(result.error.issues));
}
