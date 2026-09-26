import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetData, testPrisma } from './db.js';
import { expectAppError, makeOrg, services } from './fixtures.js';

const prisma = testPrisma();
const { org } = services(prisma);
afterAll(() => prisma.$disconnect());
beforeEach(() => resetData(prisma));

describe('regions, clusters, counties', () => {
  it('creates the hierarchy and rejects duplicates and inactive parents', async () => {
    const { region, cluster } = await makeOrg(org);
    await expectAppError(org.createRegion({ code: region.code.toLowerCase(), name: 'Other' }, null), 409, 'ALREADY_EXISTS');
    await expectAppError(org.createCluster({ regionId: region.id, code: 'NEW-1', name: cluster.name }, null), 409, 'ALREADY_EXISTS');
    await org.updateRegion(region.id, { isActive: false }, null);
    await expectAppError(org.createCluster({ regionId: region.id, code: 'NEW-2', name: 'New' }, null), 422, 'INACTIVE_PARENT');
  });

  it('validates codes and rejects unknown fields', async () => {
    await expectAppError(org.createRegion({ code: 'has space', name: 'X' }, null), 422, 'VALIDATION_FAILED');
    await expectAppError(org.createRegion({ code: 'OK', name: 'X', extra: 1 }, null), 422, 'VALIDATION_FAILED');
    await expectAppError(org.createRegion({ code: 'OK', name: '' }, null), 422, 'VALIDATION_FAILED');
  });

  it('lists the whole tree in name order', async () => {
    await makeOrg(org, 'b');
    await makeOrg(org, 'a');
    const tree = await org.listHierarchy();
    expect(tree.map((r) => r.name)).toEqual(['Region a', 'Region b']);
    expect(tree[0]!.clusters[0]!.counties[0]!.name).toBe('County a');
  });
});

describe('sites', () => {
  it('derives region and cluster from the county, and records who created it', async () => {
    const { region, cluster, county } = await makeOrg(org);
    const actor = await prisma.user.create({ data: { email: 'admin@example.com', fullName: 'Admin' } });
    const site = await org.createSite({ siteCode: ' 1402 ', siteName: 'Bomi Hills', countyId: county.id, latitude: 6.8, longitude: -10.8 }, actor.id);
    expect(site).toMatchObject({ siteCode: '1402', regionId: region.id, clusterId: cluster.id, countyId: county.id, createdById: actor.id, status: 'ACTIVE' });
    expect(Number(site.latitude)).toBe(6.8);
  });

  it('accepts a site known only by region (cluster and county not invented)', async () => {
    const { region } = await makeOrg(org);
    const site = await org.createSite({ siteCode: 'R-ONLY', siteName: 'Region only', regionId: region.id }, null);
    expect(site).toMatchObject({ clusterId: null, countyId: null });
  });

  it('rejects contradictory placements, missing placement and half coordinates', async () => {
    const a = await makeOrg(org);
    const b = await makeOrg(org);
    await expectAppError(org.createSite({ siteCode: 'S1', siteName: 'x', countyId: a.county.id, regionId: b.region.id }, null), 422, 'HIERARCHY_MISMATCH');
    await expectAppError(org.createSite({ siteCode: 'S2', siteName: 'x', clusterId: a.cluster.id, regionId: b.region.id }, null), 422, 'HIERARCHY_MISMATCH');
    await expectAppError(org.createSite({ siteCode: 'S3', siteName: 'x' }, null), 422, 'VALIDATION_FAILED');
    await expectAppError(org.createSite({ siteCode: 'S4', siteName: 'x', regionId: a.region.id, latitude: 6.5 }, null), 422, 'VALIDATION_FAILED');
    await expectAppError(org.createSite({ siteCode: 'S5', siteName: 'x', regionId: a.region.id, latitude: 95, longitude: 1 }, null), 422, 'VALIDATION_FAILED');
    await expectAppError(org.createSite({ siteCode: 'S6', siteName: 'x', regionId: '00000000-0000-7000-8000-000000000000' }, null), 422, 'INVALID_REFERENCE');
  });

  it('moves a site: the given level decides and the rest follows; inactive targets are refused', async () => {
    const a = await makeOrg(org);
    const b = await makeOrg(org);
    const site = await org.createSite({ siteCode: 'MOVE', siteName: 'x', countyId: a.county.id }, null);
    const moved = await org.updateSite(site.id, { clusterId: b.cluster.id }, null);
    expect(moved).toMatchObject({ regionId: b.region.id, clusterId: b.cluster.id, countyId: null });
    const renamed = await org.updateSite(site.id, { siteName: 'Renamed' }, null);
    expect(renamed).toMatchObject({ siteName: 'Renamed', clusterId: b.cluster.id });
    await org.updateCluster(a.cluster.id, { isActive: false }, null);
    await expectAppError(org.updateSite(site.id, { countyId: a.county.id }, null), 422, 'INACTIVE_PARENT');
    await expectAppError(org.updateSite('00000000-0000-7000-8000-000000000000', { siteName: 'x' }, null), 404, 'NOT_FOUND');
  });

  it('lists with search, filters and bounded pages', async () => {
    const a = await makeOrg(org);
    const b = await makeOrg(org);
    for (let i = 1; i <= 30; i += 1) await org.createSite({ siteCode: `A-${String(i).padStart(2, '0')}`, siteName: `Alpha ${i}`, countyId: a.county.id }, null);
    await org.createSite({ siteCode: 'B-01', siteName: 'Tienii Hill', regionId: b.region.id }, null);
    const page2 = await org.listSites({ regionId: a.region.id, page: '2', pageSize: '10' });
    expect(page2).toMatchObject({ total: 30, page: 2, pageSize: 10 });
    expect(page2.items.map((s) => s.siteCode)).toEqual(['A-11', 'A-12', 'A-13', 'A-14', 'A-15', 'A-16', 'A-17', 'A-18', 'A-19', 'A-20']);
    expect(page2.items[0]!.county?.name).toBe(a.county.name);
    expect((await org.listSites({ q: 'tienii' })).items.map((s) => s.siteCode)).toEqual(['B-01']);
    await expectAppError(org.listSites({ pageSize: '500' }), 422, 'VALIDATION_FAILED');
  });
});
