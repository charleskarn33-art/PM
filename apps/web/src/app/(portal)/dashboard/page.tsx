import { can, PM_CATEGORY_LABELS, ROLE_LABELS } from '@ipt/shared';
import {
  BatteryCharging,
  CalendarCheck,
  CalendarClock,
  CalendarX,
  CircleGauge,
  Cable,
  Fuel,
  Info,
  Leaf,
  MapPin,
  Percent,
  ShieldAlert,
  Sun,
  TriangleAlert,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { KpiCard } from '@/components/kpi-card';
import { Alert } from '@/components/ui/alert';
import { requireSession } from '@/lib/auth';
import { loadDashboard, monthPeriod, PM_CATEGORIES } from '@/lib/dashboard';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Dashboard' };

const CATEGORY_ICONS: Record<(typeof PM_CATEGORIES)[number], LucideIcon> = {
  GENERATOR: Fuel,
  DC_SYSTEM: CircleGauge,
  BATTERY: BatteryCharging,
  SOLAR: Sun,
  NON_TECHNICAL: Leaf,
  EARTHING: Cable,
};

export default async function DashboardPage() {
  const session = await requireSession();
  const supabase = await createClient();
  const data = await loadDashboard(supabase, monthPeriod(new Date()));
  const { pm } = data;

  const scopeText =
    session.role === 'super_admin' || session.role === 'viewer'
      ? 'All regions'
      : session.regionNames.length > 0
        ? session.regionNames.join(', ')
        : session.role === 'technician' || session.role === 'maintenance'
          ? 'Your assigned work'
          : 'No regions assigned';

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {ROLE_LABELS[session.role]} · {scopeText}
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          PM period: {data.period.label}
          {can(session.role, 'view_reports') ? (
            <>
              {' · '}
              <Link href="/analytics" className="text-info hover:underline">
                Trends and analytics
              </Link>
            </>
          ) : null}
        </p>
      </div>

      {data.sites.demo > 0 ? (
        <Alert tone="info" className="flex items-start gap-2">
          <Info className="mt-0.5" aria-hidden />
          <span>
            {data.sites.demo} demo site{data.sites.demo === 1 ? ' is' : 's are'} included (seeded from the Tienii 1301
            reference report). Demo records are not live operational data.
          </span>
        </Alert>
      ) : null}

      <section aria-labelledby="pm-heading" className="space-y-3">
        <h2 id="pm-heading" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Preventive maintenance — due in {data.period.label}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          <KpiCard label="Total Sites" value={data.sites.total} icon={MapPin} hint="Active and inactive, in your scope" />
          <KpiCard label="PM Scheduled" value={pm.scheduled} icon={CalendarClock} tone="info" />
          <KpiCard label="PM Completed" value={pm.completed} icon={CalendarCheck} tone="success" hint="Completed, submitted or approved" />
          <KpiCard label="PM Pending" value={pm.pending} icon={CalendarClock} tone="warning" />
          <KpiCard label="PM Overdue" value={pm.overdue} icon={CalendarX} tone="danger" />
          <KpiCard
            label="Completion"
            value={pm.completionPct === null ? '—' : `${pm.completionPct}%`}
            icon={Percent}
            tone="success"
            hint={pm.completionPct === null ? 'No PM scheduled this period' : undefined}
          />
        </div>
      </section>

      <section aria-labelledby="issues-heading" className="space-y-3">
        <h2 id="issues-heading" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Failures and corrective actions
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Total Failures" value={data.failuresThisPeriod} icon={TriangleAlert} tone="danger" hint={`Detected in ${data.period.label}`} />
          <KpiCard label="Open Failures" value={data.openFailures} icon={TriangleAlert} tone="warning" hint="Not yet verified or closed" />
          <KpiCard label="Critical Issues" value={data.criticalOpenFailures} icon={ShieldAlert} tone="danger" hint="Open, severity CRITICAL" />
          <KpiCard label="Open Corrective Actions" value={data.openCorrectiveActions} icon={Wrench} tone="info" hint="Open, assigned or in progress" />
        </div>
      </section>

      <section aria-labelledby="category-heading" className="space-y-3">
        <h2 id="category-heading" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Open issues by PM section
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          {PM_CATEGORIES.map((category) => (
            <KpiCard
              key={category}
              label={`${PM_CATEGORY_LABELS[category]} Issues`}
              value={data.openFailuresByCategory[category]}
              icon={CATEGORY_ICONS[category]}
              tone={data.openFailuresByCategory[category] > 0 ? 'danger' : 'neutral'}
            />
          ))}
        </div>
      </section>

      <p className="text-xs text-muted-foreground">
        Trend charts (completion by region/county/technician, failure trends, DC load, battery voltage and generator
        service) are delivered in Phase 7 once PM visit data is being captured.
      </p>
    </div>
  );
}
