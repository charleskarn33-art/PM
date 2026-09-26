import { HttpStatus } from '@nestjs/common';
import { AppError } from './http-exception.filter.js';

interface AdapterCause {
  originalCode?: string;
  originalMessage?: string;
  constraint?: { index?: string };
  table?: string;
}

function causeOf(e: unknown): { code?: string; cause?: AdapterCause } {
  if (!e || typeof e !== 'object') return {};
  const err = e as { code?: string; meta?: { driverAdapterError?: { cause?: AdapterCause } } };
  return { code: err.code, cause: err.meta?.driverAdapterError?.cause };
}

/** Unique indexes → the input field a caller can fix. */
const UNIQUE_FIELDS: Record<string, string> = {
  users_email_key: 'email',
  users_employee_code_key: 'employeeCode',
  regions_code_key: 'code',
  regions_name_key: 'name',
  clusters_code_key: 'code',
  clusters_region_id_name_key: 'name',
  counties_code_key: 'code',
  counties_cluster_id_name_key: 'name',
  sites_site_code_key: 'siteCode',
};

/**
 * Turns database constraint errors into API errors. The services validate
 * first; this covers races (two requests creating the same code) and any
 * rule only the database enforces. Anything else is re-thrown unchanged.
 */
export function rethrowDbError(e: unknown): never {
  const { code, cause } = causeOf(e);
  if (code === 'P2002') {
    const field = UNIQUE_FIELDS[cause?.constraint?.index ?? ''];
    throw new AppError(HttpStatus.CONFLICT, 'ALREADY_EXISTS', field ? `A record with this ${field} already exists.` : 'This record already exists.', field ? { field } : undefined);
  }
  if (code === 'P2003' || code === 'P2014') {
    // MySQL 1451: the row is still referenced (delete/update of a parent); 1452: the referenced row does not exist.
    if (cause?.originalCode === '1451') throw new AppError(HttpStatus.CONFLICT, 'IN_USE', 'This record is in use and cannot be deleted.');
    throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'INVALID_REFERENCE', 'A referenced record does not exist.');
  }
  if (cause?.originalCode === '3819') {
    throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'INVALID_VALUE', 'A value is outside its allowed range.');
  }
  if (cause?.originalCode === '1644') {
    // Raised by our own triggers (SIGNAL 45000) with a message written for users.
    throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'HIERARCHY_MISMATCH', (cause.originalMessage ?? '').replace(/^\w+: /, '') || 'Organisation hierarchy mismatch.');
  }
  throw e;
}

export const notFound = (what: string) => new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', `${what} not found.`);
export const invalid = (code: string, message: string, details?: unknown) => new AppError(HttpStatus.UNPROCESSABLE_ENTITY, code, message, details);
