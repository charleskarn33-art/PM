import type { PrismaClient } from '../generated/prisma/client.js';

/**
 * DEMONSTRATION DATA ONLY — from the IPT PowerTech Tienii (1301)
 * Preventative Maintenance Report dated 2026-09-15. Every record is flagged
 * is_demo and must never be presented as operational data.
 *
 * Only facts stated in the report are used: region Grand Cape Mount, site
 * Tienii (1301), technician Abraham Cole, generator on site, solar recorded
 * as N/A. Cluster, county, coordinates and contact details are not in the
 * report and are left empty rather than invented. The PM visit and its
 * readings are added with the PM engine (Phases 4–5).
 */
export const DEMO = {
  regionCode: 'GCM',
  regionName: 'Grand Cape Mount',
  siteCode: '1301',
  siteName: 'Tienii',
  technicianName: 'Abraham Cole',
  // Reserved `.invalid` domain: clearly not a real mailbox. No password is
  // set, so the demo account cannot sign in.
  technicianEmail: 'abraham.cole@demo.invalid',
  reportDate: '2026-09-15',
} as const;

export async function seedDemoData(prisma: PrismaClient): Promise<{ regionId: string; siteId: string; technicianId: string }> {
  return prisma.$transaction(async (tx) => {
    const region = await tx.region.upsert({
      where: { code: DEMO.regionCode },
      create: { code: DEMO.regionCode, name: DEMO.regionName, isDemo: true },
      update: {},
    });
    const site = await tx.site.upsert({
      where: { siteCode: DEMO.siteCode },
      create: {
        siteCode: DEMO.siteCode,
        siteName: DEMO.siteName,
        regionId: region.id,
        generatorAvailable: true,
        solarAvailable: false,
        isDemo: true,
      },
      update: {},
    });
    if (!site.isDemo) throw new Error(`Site ${DEMO.siteCode} exists as operational data; the demo seed will not touch it.`);

    const technicianRole = await tx.role.findUniqueOrThrow({ where: { code: 'TECHNICIAN' } });
    const technician = await tx.user.upsert({
      where: { email: DEMO.technicianEmail },
      create: { email: DEMO.technicianEmail, fullName: DEMO.technicianName, homeRegionId: region.id, isDemo: true },
      update: {},
    });
    await tx.userRole.upsert({
      where: { userId_roleId: { userId: technician.id, roleId: technicianRole.id } },
      create: { userId: technician.id, roleId: technicianRole.id },
      update: {},
    });
    const assigned = await tx.siteAssignment.findFirst({ where: { siteId: site.id, userId: technician.id, role: 'TECHNICIAN', active: true } });
    if (!assigned) {
      // The report date is the only date known for this assignment.
      await tx.siteAssignment.create({
        data: { siteId: site.id, userId: technician.id, role: 'TECHNICIAN', startDate: new Date(DEMO.reportDate), isDemo: true },
      });
    }
    return { regionId: region.id, siteId: site.id, technicianId: technician.id };
  });
}

/** Removes every demo record (and nothing else). */
export async function removeDemoData(prisma: PrismaClient): Promise<Record<string, number>> {
  return prisma.$transaction(async (tx) => {
    const demoUsers = (await tx.user.findMany({ where: { isDemo: true }, select: { id: true } })).map((u) => u.id);
    const assignments = await tx.siteAssignment.deleteMany({ where: { isDemo: true } });
    const roles = await tx.userRole.deleteMany({ where: { userId: { in: demoUsers } } });
    const scopes = await tx.userRegionScope.deleteMany({ where: { userId: { in: demoUsers } } });
    const users = await tx.user.deleteMany({ where: { isDemo: true } });
    const sites = await tx.site.deleteMany({ where: { isDemo: true } });
    const counties = await tx.county.deleteMany({ where: { isDemo: true } });
    const clusters = await tx.cluster.deleteMany({ where: { isDemo: true } });
    const regions = await tx.region.deleteMany({ where: { isDemo: true, sites: { none: {} }, clusters: { none: {} }, homeOfUsers: { none: {} } } });
    return {
      assignments: assignments.count,
      userRoles: roles.count,
      regionScopes: scopes.count,
      users: users.count,
      sites: sites.count,
      counties: counties.count,
      clusters: clusters.count,
      regions: regions.count,
    };
  });
}
