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
