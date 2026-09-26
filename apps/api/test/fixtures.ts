import { expect } from 'vitest';
import { AssignmentsService } from '../src/assignments/assignments.service.js';
import { AppError } from '../src/common/http-exception.filter.js';
import { OrganisationService } from '../src/organisation/organisation.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { UsersService } from '../src/users/users.service.js';

export function services(prisma: PrismaService) {
  return { org: new OrganisationService(prisma), users: new UsersService(prisma), assignments: new AssignmentsService(prisma) };
}

/** Expects an AppError with this HTTP status and code. */
export async function expectAppError(p: Promise<unknown>, status: number, code: string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, `expected ${status} ${code}`).toBeInstanceOf(AppError);
  expect({ status: (err as AppError).getStatus(), code: (err as AppError).code }).toEqual({ status, code });
  return err as AppError;
}

let seq = 0;
const next = () => `${Date.now().toString(36)}${(seq += 1)}`;

/** Region → cluster → county, all active. */
export async function makeOrg(org: OrganisationService, label = next()) {
  const region = await org.createRegion({ code: `R-${label}`, name: `Region ${label}` }, null);
  const cluster = await org.createCluster({ regionId: region.id, code: `K-${label}`, name: `Cluster ${label}` }, null);
  const county = await org.createCounty({ clusterId: cluster.id, code: `C-${label}`, name: `County ${label}` }, null);
  return { region, cluster, county };
}

export async function makeUser(users: UsersService, roles: string[], extra: Record<string, unknown> = {}) {
  const id = next();
  return users.createUser({ email: `user.${id}@example.com`, fullName: `User ${id}`, roles, ...extra }, null);
}
