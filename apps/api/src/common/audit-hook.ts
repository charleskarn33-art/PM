import type { Request } from 'express';

/** Provided by the audit module: records refused requests and failed sign-ins (the exception filter calls it). */
export const AUDIT_REFUSALS = Symbol('AUDIT_REFUSALS');

export interface AuditRefusals {
  /** Never throws. */
  record(req: Request, status: number, code: string): Promise<void>;
}
