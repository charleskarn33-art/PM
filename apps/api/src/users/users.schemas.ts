import { z } from 'zod';
import { ROLE_CODES } from '../authz/catalog.js';

const roleCode = z.enum(ROLE_CODES as [string, ...string[]]);
const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
const roles = z.array(roleCode).min(1, 'give at least one role').transform((r) => [...new Set(r)]);
const regionIds = z.array(z.uuid()).transform((r) => [...new Set(r)]);

export const UserInput = z.strictObject({
  email,
  fullName: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(32).nullish(),
  employeeCode: z.string().trim().max(32).nullish(),
  roles,
  homeRegionId: z.uuid().nullish(),
  reportsToId: z.uuid().nullish(),
  regionScopeIds: regionIds.default([]),
});
export const UserPatch = z.strictObject({
  fullName: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().max(32).nullish(),
  employeeCode: z.string().trim().max(32).nullish(),
  homeRegionId: z.uuid().nullish(),
  reportsToId: z.uuid().nullish(),
});
export const RolesInput = z.strictObject({ roles });
export const RegionScopeInput = z.strictObject({ regionIds });

export type UserInput = z.infer<typeof UserInput>;
