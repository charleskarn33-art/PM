import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { toIso } from './dates.js';
import { toEngineRule } from './mapping.js';
import { TemplatesService } from './templates.service.js';
import { VisitsService } from './visits.service.js';

/** Open visits sent in full; more than this is not a normal field workload, the rest are listed only. */
const MAX_FULL_VISITS = 50;

/**
 * The field pack: everything a technician's phone keeps so PM work continues
 * without a connection — the sites they may start PM at, their open PM
 * schedules, the active template versions, the consistency rules, the
 * settings the phone applies (geofence, signature), and their open visits in
 * full. Read-only; the phone downloads it when online.
 */
@Injectable()
export class FieldService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly templates: TemplatesService,
    private readonly visits: VisitsService,
  ) {}

  async pack(caller: AuthUser) {
    const generatedAt = new Date().toISOString();
    const assigned = await this.prisma.siteAssignment.findMany({ where: { userId: caller.id, role: 'TECHNICIAN', active: true }, select: { siteId: true } });
    const siteIds = [...new Set(assigned.map((a) => a.siteId))];
    const [settings, sites, schedules, templates, rules, openVisits] = await Promise.all([
      this.settings.all(),
      this.prisma.site.findMany({
        where: { id: { in: siteIds } },
        orderBy: [{ siteCode: 'asc' }],
        include: { region: { select: { name: true } }, cluster: { select: { name: true } }, county: { select: { name: true } } },
      }),
      this.prisma.pmSchedule.findMany({
        where: { siteId: { in: siteIds }, technicianId: caller.id, status: { in: ['SCHEDULED', 'OVERDUE', 'IN_PROGRESS', 'REJECTED'] } },
        include: {
          site: { select: { id: true, siteCode: true, siteName: true, regionId: true } },
          technician: { select: { id: true, fullName: true } },
          template: { select: { id: true, code: true, name: true, version: true } },
        },
        orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.pmTemplate.findMany({ where: { status: 'ACTIVE' }, select: { id: true }, orderBy: { code: 'asc' } }),
      this.prisma.pmConsistencyRule.findMany({ where: { isActive: true }, orderBy: { id: 'asc' } }),
      this.prisma.pmVisit.findMany({
        where: { technicianId: caller.id, status: { in: ['IN_PROGRESS', 'REJECTED'] } },
        select: { id: true },
        orderBy: { startedAt: 'desc' },
      }),
    ]);
    const full = openVisits.slice(0, MAX_FULL_VISITS);
    return {
      generatedAt,
      userId: caller.id,
      settings,
      sites,
      schedules: schedules.map((s) => ({ ...s, scheduledDate: toIso(s.scheduledDate), dueDate: toIso(s.dueDate) })),
      templates: await Promise.all(templates.map((t) => this.templates.get(t.id))),
      rules: rules.map(toEngineRule),
      visits: await Promise.all(full.map((v) => this.visits.get(v.id, caller))),
      /** Open visits beyond the ones sent in full (fetched one by one when opened). */
      moreVisitIds: openVisits.slice(MAX_FULL_VISITS).map((v) => v.id),
    };
  }
}
