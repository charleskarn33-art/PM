export interface Range {
  from: string;
  to: string;
  months: string[];
}

export interface Counts {
  due: number;
  completed: number;
  onTime: number;
  late: number;
  overdue: number;
  open: number;
  ratePct: number | null;
  onTimePct: number | null;
  belowTarget: boolean | null;
}

export interface Completion {
  range: Range;
  by: 'region' | 'county' | 'technician';
  targetPct: number | null;
  total: Counts;
  groups: (Counts & { id: string | null; name: string; region?: string })[];
  trend: (Counts & { month: string })[];
}

export interface Thresholds {
  dcLoadKwMax: number | null;
  rectifierVoltageMin: number | null;
  batteryVoltageMin: number | null;
  batteryUnitVoltageMin: number | null;
  fuelLevelMinPct: number | null;
  generatorServiceHours: number | null;
  completionTargetPct: number | null;
}

export interface SiteRef {
  id: string;
  siteCode: string;
  siteName: string;
  isDemo: boolean;
  region: { id: string; name: string };
}

interface Section<Row, Figures> {
  readings: number;
  sitesReported: number;
  sitesFlagged: number;
  overall: Figures;
  sites: (Row & { visitId: string; recordedAt: string; site: SiteRef; flags: string[] })[];
  trend: (Figures & { month: string; readings: number })[];
}

export interface Power {
  range: Range;
  thresholds: Thresholds;
  dc: Section<
    { dcPowerKw: number | null; loadCurrentA: number | null; rectifierVoltageV: number | null; totalPhaseCurrentA: number | null },
    { avgDcPowerKw: number | null; maxDcPowerKw: number | null; avgLoadCurrentA: number | null; avgRectifierVoltageV: number | null }
  >;
  battery: Section<
    { batteryVoltageV: number | null; minUnitVoltageV: number | null; maxUnitVoltageV: number | null; unitsRecorded: number },
    { avgBatteryVoltageV: number | null; minBatteryVoltageV: number | null; minUnitVoltageV: number | null }
  >;
  generator: Section<
    { runningHours: number | null; fuelLevelPct: number | null; generatorKva: number | null; requiresService: boolean | null; oilPressure: string | null },
    { avgFuelLevelPct: number | null; avgRunningHours: number | null; requiresService: number }
  >;
}

export interface FailureAnalytics {
  range: Range;
  detected: number;
  closed: number;
  openNow: number;
  bySeverity: Record<'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL', number>;
  byCategory: Record<string, number>;
  trend: { month: string; detected: number; closed: number }[];
  topSites: { site: SiteRef; count: number; open: number }[];
  topItems: { id: string; code: string; prompt: string; count: number }[];
  timeToClose: { count: number; meanDays: number | null; medianDays: number | null };
}

export const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });

export const num = (v: number | null | undefined, digits = 2, unit = '') => (v == null ? '—' : `${v.toLocaleString('en-GB', { maximumFractionDigits: digits })}${unit}`);

export const FLAG_LABELS: Record<string, string> = {
  DC_LOAD_HIGH: 'DC load above limit',
  RECTIFIER_VOLTAGE_LOW: 'Rectifier voltage low',
  BATTERY_VOLTAGE_LOW: 'Battery voltage low',
  BATTERY_UNIT_LOW: 'A battery below limit',
  FUEL_LOW: 'Fuel low',
  SERVICE_HOURS_REACHED: 'Service hours reached',
};
