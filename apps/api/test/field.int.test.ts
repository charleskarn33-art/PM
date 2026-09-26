import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
let prisma: PrismaService;
type As = Awaited<ReturnType<typeof signIn>>;
let tech: As;
let admin: As;
let supervisor: As;
let sites: { located: string; unlocated: string };

// Site at 7.0, -11.0. ~55 m north is inside 100 m; ~1.1 km north is outside.
const NEAR = { latitude: 7.0005, longitude: -11.0, accuracyM: 8 };
const FAR = { latitude: 7.01, longitude: -11.0, accuracyM: 12 };

beforeAll(async () => {
  app = await startApp(testConfig({ AUTH_RATE_LIMIT_PER_MINUTE: '1000', RATE_LIMIT_PER_MINUTE: '100000' }), false);
  http = app.getHttpServer();
  prisma = app.get(PrismaService);
});
afterAll(() => app?.close());

beforeEach(async () => {
  await resetData(prisma);
  const org = app.get(OrganisationService);
  const users = app.get(UsersService);
  const a = await makeOrg(org, 'A');
  const located = await org.createSite({ siteCode: 'G-1', siteName: 'Located', regionId: a.region.id, latitude: 7, longitude: -11 }, null);
  const unlocated = await org.createSite({ siteCode: 'G-2', siteName: 'No coordinates', regionId: a.region.id }, null);
  const make = async (roles: string[], extra: Record<string, unknown> = {}) => {
    const u = await makeUser(users, roles, extra);
    await setPassword(prisma, u.id);
    return u;
  };
  const t = await make(['TECHNICIAN']);
  const ad = await make(['SUPER_ADMIN']);
  const sv = await make(['REGIONAL_SUPERVISOR'], { regionScopeIds: [a.region.id] });
  for (const s of [located, unlocated]) await app.get(AssignmentsService).assign({ siteId: s.id, userId: t.id, role: 'TECHNICIAN', startDate: '2026-09-01' }, null);
  sites = { located: located.id, unlocated: unlocated.id };
  tech = await signIn(http, t.email);
  admin = await signIn(http, ad.email);
  supervisor = await signIn(http, sv.email);
});

const setFence = (mode: string, radiusM = 100) => admin.put('/settings/geofence', { mode, radiusM }).expect(200);

describe('settings', () => {
  it('everyone signed in reads them; only administrators change them, validated', async () => {
    expect((await tech.get('/settings').expect(200)).body.data).toEqual({ geofence: { mode: 'WARN', radiusM: 100 }, pm: { requireSignature: true } });
    await supervisor.put('/settings/geofence', { mode: 'BLOCK', radiusM: 50 }).expect(403);
    await admin.put('/settings/geofence', { mode: 'STRICT', radiusM: 50 }).expect(422);
    await admin.put('/settings/geofence', { mode: 'BLOCK', radiusM: 0 }).expect(422);
    await admin.put('/settings/unknown', {}).expect(404);
    await setFence('BLOCK', 250);
    expect((await tech.get('/settings').expect(200)).body.data.geofence).toEqual({ mode: 'BLOCK', radiusM: 250 });
  });
});

describe('PM start geofence', () => {
  it('WARN (default): starts anywhere and records the position, distance and result', async () => {
    const v = (await tech.post('/visits', { siteId: sites.located, gps: FAR }).expect(201)).body.data;
    expect(v).toMatchObject({ gpsStatus: 'OUTSIDE_RADIUS', geofenceMode: 'WARN', gpsRadiusM: 100, gpsLatitude: 7.01, gpsAccuracyM: 12 });
    expect(v.gpsDistanceM).toBeGreaterThan(1000);
    const near = (await tech.post('/visits', { siteId: sites.located, gps: NEAR }).expect(201)).body.data;
    expect(near.gpsStatus).toBe('WITHIN_RADIUS');
    const noGps = (await tech.post('/visits', { siteId: sites.located }).expect(201)).body.data;
    expect(noGps).toMatchObject({ gpsStatus: 'UNAVAILABLE', gpsDistanceM: null });
  });

  it('REQUIRE_REASON: outside the radius or without a location a reason is needed', async () => {
    await setFence('REQUIRE_REASON');
    const refused = await tech.post('/visits', { siteId: sites.located, gps: FAR }).expect(422);
    expect(refused.body.error).toMatchObject({ code: 'REASON_REQUIRED', details: { status: 'OUTSIDE_RADIUS', radiusM: 100 } });
    expect(refused.body.error.message).toMatch(/You are 11\d\d m from the site/);
    await tech.post('/visits', { siteId: sites.located }).expect(422);
    const v = (await tech.post('/visits', { siteId: sites.located, gps: FAR, outsideRadiusReason: 'Road to the site flooded; checked from the gate.' }).expect(201)).body.data;
    expect(v).toMatchObject({ gpsStatus: 'OUTSIDE_RADIUS', outsideRadiusReason: 'Road to the site flooded; checked from the gate.' });
    await tech.post('/visits', { siteId: sites.located, gps: NEAR }).expect(201);
  });

  it('BLOCK: refuses outside the radius or without a location; a site radius overrides the default; sites without coordinates are not blocked', async () => {
    await setFence('BLOCK');
    expect((await tech.post('/visits', { siteId: sites.located, gps: FAR }).expect(422)).body.error.code).toBe('OUTSIDE_GEOFENCE');
    expect((await tech.post('/visits', { siteId: sites.located }).expect(422)).body.error.message).toMatch(/location is unavailable/);
    expect(await prisma.pmVisit.count()).toBe(0);
    await tech.post('/visits', { siteId: sites.located, gps: NEAR }).expect(201);
    await admin.patch(`/sites/${sites.located}`, { geofenceRadiusM: 2000 }).expect(200);
    expect((await tech.post('/visits', { siteId: sites.located, gps: FAR }).expect(201)).body.data).toMatchObject({ gpsStatus: 'WITHIN_RADIUS', gpsRadiusM: 2000 });
    expect((await tech.post('/visits', { siteId: sites.unlocated }).expect(201)).body.data.gpsStatus).toBe('SITE_HAS_NO_COORDINATES');
  });

  it('rejects impossible coordinates', async () => {
    await tech.post('/visits', { siteId: sites.located, gps: { latitude: 91, longitude: 0 } }).expect(422);
  });
});

describe('signature', () => {
  const strokes = [[[10, 50], [80, 20], [150, 70]], [[200, 60]]];

  it('is drawn by the server from strokes, served as a safe SVG, and cleared by later changes', async () => {
    const v = (await tech.post('/visits', { siteId: sites.located, gps: NEAR }).expect(201)).body.data;
    expect(v.issues.some((i: { kind: string }) => i.kind === 'SIGNATURE_REQUIRED')).toBe(true);
    await tech.put(`/visits/${v.id}/signature`, { width: 300, height: 100, strokes: [] }).expect(422);
    await tech.put(`/visits/${v.id}/signature`, { width: 300, height: 100, strokes: [[[10, 50], [400, 20]]] }).expect(422);
    const signed = (await tech.put(`/visits/${v.id}/signature`, { width: 300, height: 100, strokes, name: 'Abraham Cole' }).expect(200)).body.data;
    expect(signed.signature).toMatchObject({ signedName: 'Abraham Cole' });
    expect(signed.issues.some((i: { kind: string }) => i.kind === 'SIGNATURE_REQUIRED')).toBe(false);
    expect(JSON.stringify(signed)).not.toMatch(/signatureKey|signature-/);

    const img = await request(http).get(`/api/v1/visits/${v.id}/signature`).set('Authorization', `Bearer ${supervisor.session.accessToken}`).buffer(true).expect(200);
    expect(img.headers['content-type']).toBe('image/svg+xml');
    expect(img.headers['content-security-policy']).toContain("default-src 'none'");
    const svg = Buffer.isBuffer(img.body) ? img.body.toString() : String(img.text);
    expect(svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100" width="300" height="100"><path d="M10 50L80 20L150 70M200 60l0.1 0" fill="none" stroke="#000" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    );

    // A later answer clears it; the old file is removed.
    const item = signed.sections[0].items[0].id;
    const changed = (await tech.put(`/visits/${v.id}/answers`, { responses: [{ checklistItemId: item, answer: 'YES' }] }).expect(200)).body.data;
    expect(changed.signature).toBeNull();
    await request(http).get(`/api/v1/visits/${v.id}/signature`).set('Authorization', `Bearer ${tech.session.accessToken}`).expect(404);
  });

  it('can be switched off by an administrator', async () => {
    await admin.put('/settings/pm', { requireSignature: false }).expect(200);
    const v = (await tech.post('/visits', { siteId: sites.located, gps: NEAR }).expect(201)).body.data;
    expect(v.issues.some((i: { kind: string }) => i.kind === 'SIGNATURE_REQUIRED')).toBe(false);
  });
});
