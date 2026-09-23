import { OPEN_PM_STATUSES, type Enums } from '@ipt/shared';
import type { Schedule, Site, Visit } from '@/offline/types';

export interface PmRow {
  key: string;
  siteId: string;
  siteCode: string;
  siteName: string;
  status: Enums<'pm_status'>;
  due: string | null;
  scheduleId: string | null;
  templateId: string;
  visitId: string | null;
  frequency: string | null;
  completion: number | null;
  review: string | null;
  /** Changes for this PM are saved on the phone but not sent yet. */
  waitingToSend: boolean;
}

const LISTED_VISIT: Enums<'pm_status'>[] = ['IN_PROGRESS', 'COMPLETED', 'REJECTED', 'SUBMITTED'];

/**
 * The technician's PM list from the offline copy: every open schedule (with
 * its visit if started) plus unscheduled visits still in progress. A
 * submitted PM stays listed while waiting for review so the technician can
 * see it was received (or is still waiting to send).
 */
export function buildPmRows(
  schedules: readonly Schedule[],
  visits: readonly Visit[],
  sites: readonly Site[],
  technicianId: string,
  pendingVisitIds: ReadonlySet<string>,
): PmRow[] {
  const siteById = new Map(sites.map((s) => [s.id, s]));
  const mine = visits.filter((v) => v.technician_id === technicianId && LISTED_VISIT.includes(v.status));
  const visitBySchedule = new Map(mine.filter((v) => v.schedule_id).map((v) => [v.schedule_id!, v]));
  const rows: PmRow[] = [];
  const base = (siteId: string) => {
    const site = siteById.get(siteId);
    return { siteId, siteCode: site?.site_code ?? '—', siteName: site?.site_name ?? 'Site not available offline' };
  };

  for (const s of schedules) {
    if (s.technician_id !== technicianId) continue;
    const v = visitBySchedule.get(s.id);
    if (!v && ![...OPEN_PM_STATUSES, 'REJECTED'].includes(s.status)) continue;
    rows.push({
      key: `s-${s.id}`,
      ...base(s.site_id),
      status: v?.status ?? s.status,
      due: s.due_date,
      scheduleId: s.id,
      templateId: v?.template_id ?? s.template_id,
      visitId: v?.id ?? null,
      frequency: s.frequency,
      completion: v?.completion_pct ?? null,
      review: v?.review_comments ?? null,
      waitingToSend: v ? pendingVisitIds.has(v.id) : false,
    });
  }
  const listedSchedules = new Set(rows.map((r) => r.scheduleId));
  for (const v of mine) {
    if (v.schedule_id && listedSchedules.has(v.schedule_id)) continue;
    rows.push({
      key: `v-${v.id}`,
      ...base(v.site_id),
      status: v.status,
      due: null,
      scheduleId: v.schedule_id,
      templateId: v.template_id,
      visitId: v.id,
      frequency: null,
      completion: v.completion_pct,
      review: v.review_comments,
      waitingToSend: pendingVisitIds.has(v.id),
    });
  }
  // Work in progress first, then by due date.
  const rank = (r: PmRow) => (r.status === 'SUBMITTED' ? 2 : r.visitId ? 0 : 1);
  return rows.sort((a, b) => rank(a) - rank(b) || (a.due ?? '9999').localeCompare(b.due ?? '9999'));
}
