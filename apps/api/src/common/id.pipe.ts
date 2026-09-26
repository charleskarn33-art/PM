import { Injectable, type PipeTransform } from '@nestjs/common';
import { notFound } from './prisma-errors.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Route ids are UUIDs; anything else cannot exist, so it is "not found". */
@Injectable()
export class IdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!UUID.test(value)) throw notFound('Record');
    return value.toLowerCase();
  }
}
