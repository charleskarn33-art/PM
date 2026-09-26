import { Injectable } from '@nestjs/common';
import { invalid, notFound, rethrowDbError } from '../common/prisma-errors.js';
import { parseInput } from '../common/validation.js';
import type { AuthUser } from '../auth/auth-user.js';
import { regionScope, siteScope, within } from '../authz/scope.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  ClusterInput,
  ClusterPatch,
  CountyInput,
  CountyPatch,
  RegionInput,
  RegionPatch,
  SiteInput,
  SiteListQuery,
  SitePatch,
} from './organisation.schemas.js';

interface Hierarchy {
  regionId: string;
  clusterId: string | null;
  countyId: string | null;
}

/**
 * Regions → clusters → counties → sites. Every input is validated here; the
 * controllers add authentication and permissions, and pass the caller so
 * reads are limited to their scope.
 */
@Injectable()
export class OrganisationService {
  constructor(private readonly prisma: PrismaService) {}

  // --- Regions, clusters, counties ---------------------------------------------

  async createRegion(input: unknown, actorId: string | null) {
    const data = parseInput(RegionInput, input);
    return this.prisma.region.create({ data: { ...data, createdById: actorId, updatedById: actorId } }).catch(rethrowDbError);
  }

  async updateRegion(id: string, patch: unknown, actorId: string | null) {
    const data = parseInput(RegionPatch, patch);
    await this.requireRegion(id);
    return this.prisma.region.update({ where: { id }, data: { ...data, updatedById: actorId } }).catch(rethrowDbError);
  }

  async createCluster(input: unknown, actorId: string | null) {
    const data = parseInput(ClusterInput, input);
    const region = await this.requireRegion(data.regionId);
    if (!region.isActive) throw invalid('INACTIVE_PARENT', 'The region is inactive.');
    return this.prisma.cluster.create({ data: { ...data, createdById: actorId, updatedById: actorId } }).catch(rethrowDbError);
  }

  async updateCluster(id: string, patch: unknown, actorId: string | null) {
    const data = parseInput(ClusterPatch, patch);
    await this.requireCluster(id);
    return this.prisma.cluster.update({ where: { id }, data: { ...data, updatedById: actorId } }).catch(rethrowDbError);
  }

  async createCounty(input: unknown, actorId: string | null) {
    const data = parseInput(CountyInput, input);
    const cluster = await this.requireCluster(data.clusterId);
    if (!cluster.isActive) throw invalid('INACTIVE_PARENT', 'The cluster is inactive.');
    return this.prisma.county.create({ data: { ...data, createdById: actorId, updatedById: actorId } }).catch(rethrowDbError);
  }

  async updateCounty(id: string, patch: unknown, actorId: string | null) {
    const data = parseInput(CountyPatch, patch);
    await this.requireCounty(id);
    return this.prisma.county.update({ where: { id }, data: { ...data, updatedById: actorId } }).catch(rethrowDbError);
  }

  /** The tree for pickers and filters (small: tens of regions, hundreds of counties), limited to the caller's scope. */
  listHierarchy(caller?: AuthUser) {
    return this.prisma.region.findMany({
      where: caller ? regionScope(caller) : undefined,
      orderBy: { name: 'asc' },
      include: { clusters: { orderBy: { name: 'asc' }, include: { counties: { orderBy: { name: 'asc' } } } } },
    });
  }

  // --- Sites ---------------------------------------------------------------------

  async createSite(input: unknown, actorId: string | null) {
    const { regionId, clusterId, countyId, latitude, longitude, ...rest } = parseInput(SiteInput, input);
    const hierarchy = await this.resolveHierarchy({ regionId, clusterId, countyId }, true);
    return this.prisma.site
      .create({ data: { ...rest, ...hierarchy, latitude: latitude ?? null, longitude: longitude ?? null, createdById: actorId, updatedById: actorId } })
      .catch(rethrowDbError);
  }

  async updateSite(id: string, patch: unknown, actorId: string | null) {
    const { regionId, clusterId, countyId, ...rest } = parseInput(SitePatch, patch);
    const site = await this.requireSite(id);
    let hierarchy: Hierarchy | undefined;
    if (regionId !== undefined || clusterId !== undefined || countyId !== undefined) {
      // The patch gives the new placement by its most specific level; the rest is derived from it.
      const placement = { regionId, clusterId, countyId };
      hierarchy = await this.resolveHierarchy(placement, false);
      const moved = hierarchy.regionId !== site.regionId || hierarchy.clusterId !== site.clusterId || hierarchy.countyId !== site.countyId;
      if (moved) await this.resolveHierarchy(placement, true); // a move must go to active entries
    }
    return this.prisma.site.update({ where: { id }, data: { ...rest, ...hierarchy, updatedById: actorId } }).catch(rethrowDbError);
  }

  /** A site, if the caller may see it (otherwise "not found"). */
  async getSite(id: string, caller?: AuthUser) {
    const site = await this.prisma.site.findFirst({
      where: within<Prisma.SiteWhereInput>(caller ? siteScope(caller) : undefined, { id }),
      include: {
        region: { select: { id: true, code: true, name: true } },
        cluster: { select: { id: true, code: true, name: true } },
        county: { select: { id: true, code: true, name: true } },
      },
    });
    if (!site) throw notFound('Site');
    return site;
  }

  /** Paginated site list with filters (no unbounded reads), limited to the caller's scope. */
  async listSites(query: unknown, caller?: AuthUser) {
    const q = parseInput(SiteListQuery, query);
    const where: Prisma.SiteWhereInput = {
      AND: [
        (caller && siteScope(caller)) ?? {},
        q.regionId ? { regionId: q.regionId } : {},
        q.clusterId ? { clusterId: q.clusterId } : {},
        q.countyId ? { countyId: q.countyId } : {},
        q.status ? { status: q.status } : {},
        q.q ? { OR: [{ siteCode: { contains: q.q } }, { siteName: { contains: q.q } }] } : {},
      ],
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.site.findMany({
        where,
        orderBy: [{ siteCode: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { region: { select: { name: true } }, cluster: { select: { name: true } }, county: { select: { name: true } } },
      }),
      this.prisma.site.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  // --- Helpers -------------------------------------------------------------------

  /**
   * Completes a site's place in the hierarchy from its most specific level
   * (county → cluster → region) and rejects contradictions. New links must
   * point at active entries.
   */
  private async resolveHierarchy(
    given: { regionId?: string; clusterId?: string | null; countyId?: string | null },
    requireActive: boolean,
  ): Promise<Hierarchy> {
    if (given.countyId) {
      const county = await this.prisma.county.findUnique({ where: { id: given.countyId }, include: { cluster: true } });
      if (!county) throw invalid('INVALID_REFERENCE', 'The county does not exist.');
      if (given.clusterId && given.clusterId !== county.clusterId) throw invalid('HIERARCHY_MISMATCH', 'The county does not belong to that cluster.');
      if (given.regionId && given.regionId !== county.cluster.regionId) throw invalid('HIERARCHY_MISMATCH', 'The county does not belong to that region.');
      if (requireActive && (!county.isActive || !county.cluster.isActive)) throw invalid('INACTIVE_PARENT', 'The county or its cluster is inactive.');
      await this.requireActiveRegion(county.cluster.regionId, requireActive);
      return { regionId: county.cluster.regionId, clusterId: county.clusterId, countyId: county.id };
    }
    if (given.clusterId) {
      const cluster = await this.prisma.cluster.findUnique({ where: { id: given.clusterId } });
      if (!cluster) throw invalid('INVALID_REFERENCE', 'The cluster does not exist.');
      if (given.regionId && given.regionId !== cluster.regionId) throw invalid('HIERARCHY_MISMATCH', 'The cluster does not belong to that region.');
      if (requireActive && !cluster.isActive) throw invalid('INACTIVE_PARENT', 'The cluster is inactive.');
      await this.requireActiveRegion(cluster.regionId, requireActive);
      return { regionId: cluster.regionId, clusterId: cluster.id, countyId: null };
    }
    if (!given.regionId) throw invalid('HIERARCHY_REQUIRED', 'Give the region, cluster or county.');
    await this.requireActiveRegion(given.regionId, requireActive);
    return { regionId: given.regionId, clusterId: null, countyId: null };
  }

  private async requireActiveRegion(id: string, requireActive: boolean) {
    const region = await this.prisma.region.findUnique({ where: { id } });
    if (!region) throw invalid('INVALID_REFERENCE', 'The region does not exist.');
    if (requireActive && !region.isActive) throw invalid('INACTIVE_PARENT', 'The region is inactive.');
  }

  private async requireRegion(id: string) {
    const r = await this.prisma.region.findUnique({ where: { id } });
    if (!r) throw notFound('Region');
    return r;
  }

  private async requireCluster(id: string) {
    const c = await this.prisma.cluster.findUnique({ where: { id } });
    if (!c) throw notFound('Cluster');
    return c;
  }

  private async requireCounty(id: string) {
    const c = await this.prisma.county.findUnique({ where: { id } });
    if (!c) throw notFound('County');
    return c;
  }

  private async requireSite(id: string) {
    const s = await this.prisma.site.findUnique({ where: { id } });
    if (!s) throw notFound('Site');
    return s;
  }
}
