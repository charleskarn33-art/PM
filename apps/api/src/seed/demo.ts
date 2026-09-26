import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../generated/prisma/client.js';
import { refreshProgress } from '../pm/visit-state.js';
import { REFERENCE_TEMPLATE } from './reference-template.js';

/**
 * DEMONSTRATION DATA ONLY — from the IPT PowerTech Tienii (1301)
 * Preventative Maintenance Report dated 2026-09-15. Every record is flagged
 * is_demo and must never be presented as operational data.
 *
 * Only facts stated in the report are used: region Grand Cape Mount, site
 * Tienii (1301), technician Abraham Cole, generator on site, solar recorded
 * as N/A. Cluster, county, coordinates and contact details are not in the
 * report and are left empty rather than invented.
 *
 * The PM visit carries the readings stated in the report. The report's
 * checklist answers have not been transcribed, so none are seeded: the
 * visit's completion % is what the engine computes from the recorded data,
 * not a copied figure. The time of day is not in the report; the visit is
 * dated at 00:00 UTC on the report date.
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
  /** Reading values as stated in the report, by reading-field code. Solar: N/A (no solar at the site). */
  readings: {
    running_hours: 877,
    oil_pressure: 'Okay',
    fuel_level: 12.7,
    generator_kva: 20,
    rectifier_output_voltage: 52.99,
    load_current: 52.7,
    rectifier_module_count: 6,
    dc_modules_installed: 3,
    dc_modules_operational: 3,
    battery_voltage: 52.5,
    battery_capacity: 200,
    battery_strings: 8,
  } as Record<string, number | string>,
} as const;

export async function seedDemoData(prisma: PrismaClient): Promise<{ regionId: string; siteId: string; technicianId: string; visitId: string | null }> {
  const base = await prisma.$transaction(async (tx) => {
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
  return { ...base, visitId: await seedDemoVisit(prisma, base.siteId, base.technicianId) };
}

/** The Tienii PM of the report date: completed, with the report's readings. Needs the reference template. */
async function seedDemoVisit(prisma: PrismaClient, siteId: string, technicianId: string): Promise<string | null> {
  const template = await prisma.pmTemplate.findFirst({ where: { code: REFERENCE_TEMPLATE.code, version: 1 } });
  if (!template) return null; // run `pnpm db:seed` first
  const existing = await prisma.pmVisit.findFirst({ where: { siteId, isDemo: true } });
  if (existing) return existing.id;
  return prisma.$transaction(async (tx) => {
    const day = new Date(`${DEMO.reportDate}T00:00:00.000Z`);
    const schedule = await tx.pmSchedule.create({
      data: { siteId, templateId: template.id, technicianId, frequency: 'AD_HOC', scheduledDate: day, dueDate: day, status: 'COMPLETED', isDemo: true },
    });
    const visit = await tx.pmVisit.create({
      data: {
        id: randomUUID(),
        scheduleId: schedule.id,
        siteId,
        templateId: template.id,
        technicianId,
        status: 'COMPLETED',
        startedAt: day,
        completedAt: day,
        notApplicableSections: ['SOLAR'],
        isDemo: true,
      },
    });
    const fields = await tx.pmReadingField.findMany({ where: { section: { templateId: template.id }, code: { in: Object.keys(DEMO.readings) } } });
    for (const f of fields) {
      const value = DEMO.readings[f.code]!;
      await tx.pmReading.create({
        data: {
          visitId: visit.id,
          readingFieldId: f.id,
          numericValue: typeof value === 'number' ? value : null,
          textValue: typeof value === 'string' ? value : null,
          labelSnapshot: f.label,
          unitSnapshot: f.unit,
          capturedAt: day,
        },
      });
    }
    await refreshProgress(tx, visit);
    return visit.id;
  });
}

/** Removes every demo record (and nothing else). */
export async function removeDemoData(prisma: PrismaClient): Promise<Record<string, number>> {
  return prisma.$transaction(async (tx) => {
    const demoUsers = (await tx.user.findMany({ where: { isDemo: true }, select: { id: true } })).map((u) => u.id);
    const visits = await tx.pmVisit.deleteMany({ where: { isDemo: true } }); // answers and readings cascade
    const schedules = await tx.pmSchedule.deleteMany({ where: { isDemo: true } });
    const assignments = await tx.siteAssignment.deleteMany({ where: { isDemo: true } });
    const roles = await tx.userRole.deleteMany({ where: { userId: { in: demoUsers } } });
    const scopes = await tx.userRegionScope.deleteMany({ where: { userId: { in: demoUsers } } });
    const users = await tx.user.deleteMany({ where: { isDemo: true } });
    const sites = await tx.site.deleteMany({ where: { isDemo: true } });
    const counties = await tx.county.deleteMany({ where: { isDemo: true } });
    const clusters = await tx.cluster.deleteMany({ where: { isDemo: true } });
    const regions = await tx.region.deleteMany({ where: { isDemo: true, sites: { none: {} }, clusters: { none: {} }, homeOfUsers: { none: {} } } });
    return {
      visits: visits.count,
      schedules: schedules.count,
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
