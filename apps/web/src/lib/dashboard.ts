import type { Database, Enums } from '@ipt/shared';
import type { SupabaseClient } from '@supabase/supabase-js';

type Client = SupabaseClient<Database>;
type PmCategory = Enums<'pm_category'>;

export const PM_CATEGORIES: readonly PmCategory[] = [
  'GENERATOR',
  'DC_SYSTEM',
  'BATTERY',
  'SOLAR',
  'NON_TECHNICAL',
  'EARTHING',
];

/** PM schedules due in the period. */
export interface PmPeriodCounts {
  scheduled: number;
  completed: number;
  overdue: number;
}

export interface PmKpis extends PmPeriodCounts {
  pending: number;
  /** null when nothing is scheduled (avoid reporting a misleading 0%). */
  completionPct: number | null;
}

export function derivePmKpis({ scheduled, completed, overdue }: PmPeriodCounts): PmKpis {
  const pending = Math.max(0, scheduled - completed - overdue);
  const completionPct = scheduled > 0 ? Math.round((completed / scheduled) * 1000) / 10 : null;
  return { scheduled, completed, overdue, pending, completionPct };
}

export interface DashboardPeriod {
  /** YYYY-MM-DD */
  today: string;
  monthStart: string;
  monthEnd: string;
  label: string;
}

export function monthPeriod(now: Date): DashboardPeriod {
  const y = now.getFullYear();
  const m = now.getMonth();
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return {
    today: fmt(now),
    monthStart: fmt(new Date(y, m, 1)),
    monthEnd: fmt(new Date(y, m + 1, 0)),
    label: now.toLocaleString('en-GB', { month: 'long', year: 'numeric' }),
  };
}

export interface DashboardData {
  period: DashboardPeriod;
  sites: { total: number; demo: number };
  pm: PmKpis;
  failuresThisPeriod: number;
  openFailures: number;
  criticalOpenFailures: number;
  openFailuresByCategory: Record<PmCategory, number>;
  openCorrectiveActions: number;
}

const COMPLETED_STATUSES = ['COMPLETED', 'SUBMITTED', 'APPROVED'] as const;
const OPEN_FAILURE_EXCLUDED = '("VERIFIED","CLOSED")';

async function count(label: string, query: PromiseLike<{ count: number | null; error: { message: string } | null }>) {
  const { count: value, error } = await query;
  if (error) throw new Error(`Failed to load ${label}: ${error.message}`);
  return value ?? 0;
}

/**
 * Loads dashboard KPIs as the signed-in user. Every figure is scoped by RLS,
 * so supervisors and managers automatically see only their regions.
 */
export async function loadDashboard(supabase: Client, period: DashboardPeriod): Promise<DashboardData> {
  const head = { count: 'exact' as const, head: true };
  const schedulesDue = () =>
    supabase
      .from('pm_schedules')
      .select('id', head)
      .gte('due_date', period.monthStart)
      .lte('due_date', period.monthEnd);
  const openFailures = () => supabase.from('failures').select('id', head).not('status', 'in', OPEN_FAILURE_EXCLUDED);

  const [
    totalSites,
    demoSites,
    scheduled,
    completed,
    overdue,
    failuresThisPeriod,
    openFailureCount,
    criticalOpenFailures,
    openCorrectiveActions,
    ...byCategory
  ] = await Promise.all([
    count('sites', supabase.from('sites').select('id', head).neq('status', 'DECOMMISSIONED')),
    count('demo sites', supabase.from('sites').select('id', head).eq('is_demo', true)),
    count('scheduled PMs', schedulesDue().neq('status', 'CANCELLED')),
    count('completed PMs', schedulesDue().in('status', [...COMPLETED_STATUSES])),
    count(
      'overdue PMs',
      schedulesDue().or(
        `status.eq.OVERDUE,and(status.in.(SCHEDULED,IN_PROGRESS,REJECTED),due_date.lt.${period.today})`,
      ),
    ),
    count(
      'failures',
      supabase
        .from('failures')
        .select('id', head)
        .gte('detected_at', `${period.monthStart}T00:00:00`)
        .lte('detected_at', `${period.monthEnd}T23:59:59.999`),
    ),
    count('open failures', openFailures()),
    count('critical failures', openFailures().eq('severity', 'CRITICAL')),
    count(
      'open corrective actions',
      supabase.from('corrective_actions').select('id', head).in('status', ['OPEN', 'ASSIGNED', 'IN_PROGRESS']),
    ),
    ...PM_CATEGORIES.map((category) => count(`${category} failures`, openFailures().eq('category', category))),
  ]);

  return {
    period,
    sites: { total: totalSites, demo: demoSites },
    pm: derivePmKpis({ scheduled, completed, overdue }),
    failuresThisPeriod,
    openFailures: openFailureCount,
    criticalOpenFailures,
    openFailuresByCategory: Object.fromEntries(PM_CATEGORIES.map((c, i) => [c, byCategory[i] ?? 0])) as Record<
      PmCategory,
      number
    >,
    openCorrectiveActions,
  };
}
