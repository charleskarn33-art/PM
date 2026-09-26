import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { ModulesContainer } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IS_PUBLIC } from '../src/auth/public.decorator.js';
import { ANY_SIGNED_IN, REQUIRED_PERMISSIONS } from '../src/authz/decorators.js';
import { AssignmentsService } from '../src/assignments/assignments.service.js';
import { OrganisationService } from '../src/organisation/organisation.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { UsersService } from '../src/users/users.service.js';
import { resetData } from './db.js';
import { makeOrg, makeUser } from './fixtures.js';
import { setPassword, signIn, type Http } from './http.js';
import { startApp, testConfig } from './support.js';

let app: NestExpressApplication;
let http: Http;
type As = Awaited<ReturnType<typeof signIn>>;
const as = {} as Record<'admin' | 'manager' | 'supervisor' | 'technician' | 'maintenance' | 'viewer', As>;
const ids = {} as Record<'regionA' | 'regionB' | 'siteA' | 'siteB' | 'siteA2' | 'techA' | 'techB' | 'supervisorA' | 'assignmentB', string>;

beforeAll(async () => {
  app = await startApp(testConfig({ AUTH_RATE_LIMIT_PER_MINUTE: '1000', RATE_LIMIT_PER_MINUTE: '10000' }), false);
  http = app.getHttpServer();
  const prisma = app.get(PrismaService);
  const org = app.get(OrganisationService);
  const users = app.get(UsersService);
  const assignments = app.get(AssignmentsService);
  await resetData(prisma);

  const a = await makeOrg(org, 'A');
  const b = await makeOrg(org, 'B');
  const siteA = await org.createSite({ siteCode: 'A-1', siteName: 'Site A1', countyId: a.county.id }, null);
  const siteA2 = await org.createSite({ siteCode: 'A-2', siteName: 'Site A2', regionId: a.region.id }, null);
  const siteB = await org.createSite({ siteCode: 'B-1', siteName: 'Site B1', regionId: b.region.id }, null);

  const make = async (roles: string[], extra: Record<string, unknown> = {}) => {
    const u = await makeUser(users, roles, extra);
    await setPassword(prisma, u.id);
    return u;
  };
  const admin = await make(['SUPER_ADMIN']);
  const manager = await make(['REGIONAL_MANAGER'], { regionScopeIds: [a.region.id] });
  const supervisor = await make(['REGIONAL_SUPERVISOR'], { regionScopeIds: [a.region.id] });
  const technician = await make(['TECHNICIAN'], { homeRegionId: a.region.id });
  const techB = await make(['TECHNICIAN'], { homeRegionId: b.region.id });
  const maintenance = await make(['MAINTENANCE_USER']);
  const viewer = await make(['VIEWER'], { regionScopeIds: [a.region.id] });

  await assignments.assign({ siteId: siteA.id, userId: technician.id, role: 'TECHNICIAN', startDate: '2026-09-01' }, admin.id);
  const assignmentB = await assignments.assign({ siteId: siteB.id, userId: techB.id, role: 'TECHNICIAN', startDate: '2026-09-01' }, admin.id);

  Object.assign(ids, {
    regionA: a.region.id,
    regionB: b.region.id,
    siteA: siteA.id,
    siteA2: siteA2.id,
    siteB: siteB.id,
    techA: technician.id,
    techB: techB.id,
    supervisorA: supervisor.id,
    assignmentB: assignmentB.id,
  });
  for (const [name, u] of Object.entries({ admin, manager, supervisor, technician, maintenance, viewer })) {
    as[name as keyof typeof as] = await signIn(http, u.email);
  }
});
afterAll(() => app?.close());

describe('every route declares its access rule', () => {
  it('each handler is @Public, @SignedIn or has @RequirePermissions', () => {
    const undeclared: string[] = [];
    let routes = 0;
    for (const mod of app.get(ModulesContainer).values()) {
      for (const { metatype } of mod.controllers.values()) {
        if (!metatype) continue;
        const proto = (metatype as { prototype: Record<string, unknown> }).prototype;
        for (const key of Object.getOwnPropertyNames(proto)) {
          const handler = proto[key];
          if (key === 'constructor' || typeof handler !== 'function' || Reflect.getMetadata(PATH_METADATA, handler) === undefined) continue;
          routes += 1;
          const declared = [IS_PUBLIC, REQUIRED_PERMISSIONS, ANY_SIGNED_IN].some(
            (k) => Reflect.getMetadata(k, handler) !== undefined || Reflect.getMetadata(k, metatype) !== undefined,
          );
          if (!declared) undeclared.push(`${RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler)]} ${metatype.name}.${key}`);
        }
      }
    }
    expect(routes).toBeGreaterThan(25);
    expect(undeclared).toEqual([]);
  });
});

describe('permissions by role', () => {
  // [method, path, roles allowed]; everyone else gets 403.
  const matrix: [string, () => string, string[]][] = [
    ['GET', () => '/users', ['admin', 'manager', 'supervisor']],
    ['GET', () => '/roles', ['admin', 'manager', 'supervisor']],
    ['GET', () => '/org/hierarchy', ['admin', 'manager', 'supervisor', 'viewer']],
    ['GET', () => '/sites', ['admin', 'manager', 'supervisor', 'technician', 'maintenance', 'viewer']],
    ['GET', () => `/sites/${ids.siteA}/assignments`, ['admin', 'manager', 'supervisor', 'viewer']],
    ['POST', () => '/regions', ['admin']],
    ['POST', () => '/sites', ['admin']],
    ['POST', () => '/users', ['admin']],
    ['POST', () => `/users/${ids.techA}/unlock`, ['admin']],
    ['POST', () => '/assignments', ['admin', 'supervisor']],
    ['GET', () => '/pm-templates', ['admin', 'manager', 'supervisor', 'technician', 'viewer']],
    ['POST', () => '/pm-templates', ['admin']],
    ['GET', () => '/pm-schedules', ['admin', 'manager', 'supervisor', 'technician', 'viewer']],
    ['POST', () => '/pm-schedules', ['admin', 'supervisor']],
    ['GET', () => '/visits', ['admin', 'manager', 'supervisor', 'technician', 'viewer']],
    ['POST', () => '/visits', ['admin', 'technician']],
  ];
  const roles = ['admin', 'manager', 'supervisor', 'technician', 'maintenance', 'viewer'] as const;

  for (const [method, path, allowed] of matrix) {
    it(`${method} ${path.toString().replace(/^\(\) => /, '')} → ${allowed.join(', ')}`, async () => {
      for (const role of roles) {
        const p = path();
        // Invalid bodies: allowed callers get past the guard and fail validation (422), others get 403.
        const res = method === 'GET' ? await as[role].get(p) : await as[role].post(p, {});
        const passed = res.status !== 403;
        expect({ role, path: p, passed }).toEqual({ role, path: p, passed: allowed.includes(role) });
        if (!passed) expect(res.body.error.code).toBe('FORBIDDEN');
      }
    });
  }
});

describe('organisational scope', () => {
  const siteCodes = async (who: As) => ((await who.get('/sites').expect(200)).body.data as { siteCode: string }[]).map((s) => s.siteCode);

  it('site lists are limited to the caller’s regions or assigned sites', async () => {
    expect(await siteCodes(as.admin)).toEqual(['A-1', 'A-2', 'B-1']);
    expect(await siteCodes(as.manager)).toEqual(['A-1', 'A-2']);
    expect(await siteCodes(as.supervisor)).toEqual(['A-1', 'A-2']);
    expect(await siteCodes(as.viewer)).toEqual(['A-1', 'A-2']);
    expect(await siteCodes(as.technician)).toEqual(['A-1']);
    expect(await siteCodes(as.maintenance)).toEqual([]);
    const page = await as.admin.get('/sites?pageSize=2').expect(200);
    expect(page.body.meta).toEqual({ total: 3, page: 1, pageSize: 2 });
  });

  it('an out-of-scope site answers 404, as if it did not exist', async () => {
    await as.manager.get(`/sites/${ids.siteA}`).expect(200);
    for (const who of [as.manager, as.supervisor, as.technician, as.viewer]) {
      expect((await who.get(`/sites/${ids.siteB}`).expect(404)).body.error.code).toBe('NOT_FOUND');
    }
    await as.technician.get(`/sites/${ids.siteA2}`).expect(404);
    await as.admin.get(`/sites/${ids.siteB}`).expect(200);
    await as.admin.get('/sites/not-a-uuid').expect(404);
    await as.supervisor.get(`/sites/${ids.siteB}/assignments`).expect(404);
  });

  it('the hierarchy shows only regions in scope', async () => {
    const names = async (who: As) => ((await who.get('/org/hierarchy').expect(200)).body.data as { id: string }[]).map((r) => r.id);
    expect((await names(as.admin)).sort()).toEqual([ids.regionA, ids.regionB].sort());
    expect(await names(as.supervisor)).toEqual([ids.regionA]);
  });

  it('people lists are limited to the caller’s regions and never expose password hashes', async () => {
    const list = await as.supervisor.get('/users?pageSize=100').expect(200);
    const shown = (list.body.data as { id: string }[]).map((u) => u.id);
    expect(shown).toContain(ids.techA);
    expect(shown).not.toContain(ids.techB);
    expect(JSON.stringify(list.body)).not.toMatch(/passwordHash|argon2|failedLoginCount/);
    await as.supervisor.get(`/users/${ids.techB}`).expect(404);
    const detail = await as.admin.get(`/users/${ids.techB}`).expect(200);
    expect(detail.body.data).toMatchObject({ id: ids.techB, roles: [{ code: 'TECHNICIAN', name: 'Technician' }] });
    expect(JSON.stringify(detail.body)).not.toMatch(/passwordHash|argon2/);
    const techs = await as.admin.get('/users?role=TECHNICIAN').expect(200);
    expect(techs.body.meta.total).toBe(2);
  });

  it('supervisors assign technicians only on sites in their regions and cannot appoint supervisors', async () => {
    const ok = await as.supervisor.post('/assignments', { siteId: ids.siteA2, userId: ids.techA, role: 'TECHNICIAN', startDate: '2026-09-15' }).expect(201);
    expect(ok.body.data).toMatchObject({ siteId: ids.siteA2, userId: ids.techA, active: true });
    const outside = await as.supervisor.post('/assignments', { siteId: ids.siteB, userId: ids.techA, role: 'TECHNICIAN', startDate: '2026-09-15' }).expect(422);
    expect(outside.body.error.code).toBe('INVALID_REFERENCE');
    const appoint = await as.supervisor.post('/assignments', { siteId: ids.siteA, userId: ids.supervisorA, role: 'SUPERVISOR', startDate: '2026-09-15' }).expect(403);
    expect(appoint.body.error.code).toBe('FORBIDDEN');
    await as.supervisor.post(`/assignments/${ids.assignmentB}/end`, { endDate: '2026-09-20' }).expect(404);
    await as.supervisor.post(`/assignments/${ok.body.data.id}/end`, { endDate: '2026-09-20', reason: 'Rotation' }).expect(200);
    // The technician's own list follows.
    const mine = await as.technician.get('/me/assignments').expect(200);
    expect((mine.body.data as { siteId: string }[]).map((m) => m.siteId)).toEqual([ids.siteA]);
  });

  it('administrators manage the organisation through the API', async () => {
    const region = await as.admin.post('/regions', { code: 'GCM', name: 'Grand Cape Mount' }).expect(201);
    const dup = await as.admin.post('/regions', { code: 'gcm', name: 'Other' }).expect(409);
    expect(dup.body.error).toMatchObject({ code: 'ALREADY_EXISTS', details: { field: 'code' } });
    const site = await as.admin.post('/sites', { siteCode: '1301', siteName: 'Tienii', regionId: region.body.data.id, generatorAvailable: true }).expect(201);
    expect(site.body.data).toMatchObject({ siteCode: '1301', createdById: as.admin.session.user.id });
    await as.admin.patch(`/sites/${site.body.data.id}`, { latitude: 7.1 }).expect(422);
    const moved = await as.admin.patch(`/sites/${site.body.data.id}`, { latitude: 7.1, longitude: -11.2 }).expect(200);
    expect(moved.body.data.latitude).toBe('7.1');
  });

  it('everyone can read and edit their own name and phone, and nothing else', async () => {
    const me = await as.technician.get('/me/profile').expect(200);
    expect(me.body.data).toMatchObject({ id: ids.techA, roles: [{ code: 'TECHNICIAN', name: 'Technician' }] });
    expect(JSON.stringify(me.body)).not.toMatch(/passwordHash|argon2/);
    const saved = await as.technician.patch('/me/profile', { fullName: 'Abraham Cole', phone: '+231 77 000 0000' }).expect(200);
    expect(saved.body.data).toMatchObject({ fullName: 'Abraham Cole', phone: '+231 77 000 0000' });
    expect((await as.technician.patch('/me/profile', { phone: '' }).expect(200)).body.data.phone).toBeNull();
    await as.technician.patch('/me/profile', { email: 'x@example.com' }).expect(422);
    await as.technician.patch('/me/profile', { isActive: false }).expect(422);
    await as.technician.patch('/me/profile', { phone: 'call me' }).expect(422);
  });

  it('role changes apply to the very next request', async () => {
    const users = app.get(UsersService);
    await as.admin.put(`/users/${as.viewer.session.user.id}/roles`, { roles: ['TECHNICIAN'] }).expect(200);
    await as.viewer.get('/org/hierarchy').expect(403);
    await users.setRoles(as.viewer.session.user.id, { roles: ['VIEWER'] }, null);
    await as.viewer.get('/org/hierarchy').expect(200);
  });
});
