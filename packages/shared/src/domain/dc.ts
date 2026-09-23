/**
 * DC power (kW) = Voltage (V) x Current (A) / 1000.
 *
 * Mirrors the generated column `dc_readings.dc_power_kw`. Measured values are
 * never modified; this only derives a separate figure. Returns null when either
 * measurement is missing or not a finite number.
 */
export function dcPowerKw(voltageV: number | null | undefined, currentA: number | null | undefined): number | null {
  if (voltageV == null || currentA == null) return null;
  if (!Number.isFinite(voltageV) || !Number.isFinite(currentA)) return null;
  return (voltageV * currentA) / 1000;
}

/** Sum of the recorded clamp-meter phase currents; null if none were recorded. */
export function totalPhaseCurrentA(phases: ReadonlyArray<number | null | undefined>): number | null {
  const recorded = phases.filter((p): p is number => p != null && Number.isFinite(p));
  if (recorded.length === 0) return null;
  return recorded.reduce((sum, p) => sum + p, 0);
}

/** Administrator-configured high-load thresholds (system setting `dc_thresholds`). null = not configured. */
export interface DcThresholds {
  high_load_kw: number | null;
  high_load_current_a: number | null;
}

/**
 * High-load flags for a DC reading. A flag is only ever raised against a
 * threshold an administrator configured; with none configured nothing is
 * flagged (no engineering limit is assumed).
 */
export function dcHighLoad(
  powerKw: number | null | undefined,
  loadCurrentA: number | null | undefined,
  thresholds: Partial<DcThresholds> | null | undefined,
): { kw: boolean; current: boolean } {
  const kwLimit = thresholds?.high_load_kw ?? null;
  const aLimit = thresholds?.high_load_current_a ?? null;
  return {
    kw: kwLimit != null && powerKw != null && powerKw > kwLimit,
    current: aLimit != null && loadCurrentA != null && loadCurrentA > aLimit,
  };
}
