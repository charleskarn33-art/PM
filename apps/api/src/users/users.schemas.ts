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

export const UserListQuery = z.strictObject({
  q: z.string().trim().max(100).optional(),
  role: roleCode.optional(),
  regionId: z.uuid().optional(),
  active: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/** What users may change about themselves. */
export const OwnProfilePatch = z.strictObject({
  fullName: z.string().trim().min(2).max(120).optional(),
  phone: z
    .string()
    .trim()
    .max(32)
    .regex(/^[+()\d\s-]{6,20}$/, 'use digits, spaces, +, - and parentheses')
    .nullish()
    .or(z.literal('').transform(() => null)),
});
