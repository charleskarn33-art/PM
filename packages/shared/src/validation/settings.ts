import type { Enums } from '../database.types';
import { optionalNumber, text, type RawInput, type ValidationResult } from './common';

export const GEOFENCE_MODES: readonly Enums<'geofence_mode'>[] = ['WARN', 'REQUIRE_REASON', 'BLOCK'];
export const CONSISTENCY_OPERATORS = ['<=', '<', '>=', '>', '='] as const;
export type ConsistencyOperator = (typeof CONSISTENCY_OPERATORS)[number];

export interface GeofenceSettingValue {
  radius_m: number;
  mode: Enums<'geofence_mode'>;
}

export function validateGeofenceSetting(raw: RawInput): ValidationResult<GeofenceSettingValue, 'radius_m' | 'mode'> {
  const errors: Partial<Record<'radius_m' | 'mode', string>> = {};
  const radius = optionalNumber(raw, 'radius_m');
  if (radius == null || !Number.isInteger(radius) || radius <= 0) errors.radius_m = 'Enter a whole number of metres greater than 0.';
  const mode = text(raw, 'mode') as Enums<'geofence_mode'>;
  if (!GEOFENCE_MODES.includes(mode)) errors.mode = 'Choose a mode.';
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value: { radius_m: radius!, mode } };
}

export interface DcThresholdSettingValue {
  high_load_kw: number | null;
  high_load_current_a: number | null;
}

/** Both thresholds are optional: empty means "not configured" (no flag raised). */
export function validateDcThresholds(raw: RawInput): ValidationResult<DcThresholdSettingValue, 'high_load_kw' | 'high_load_current_a'> {
  const errors: Partial<Record<'high_load_kw' | 'high_load_current_a', string>> = {};
  const value: DcThresholdSettingValue = { high_load_kw: null, high_load_current_a: null };
  for (const key of ['high_load_kw', 'high_load_current_a'] as const) {
    const n = optionalNumber(raw, key);
    if (n === undefined || (n != null && n <= 0)) errors[key] = 'Leave empty, or enter a number greater than 0.';
    else value[key] = n;
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value };
}

export interface ConsistencyRuleValue {
  lhs_key: string;
  operator: ConsistencyOperator;
  rhs_key: string;
  message: string;
  is_active: boolean;
}

type RuleField = 'lhs_key' | 'operator' | 'rhs_key' | 'message';

/** `knownKeys`: analytics keys defined on the templates (numeric items and readings). */
export function validateConsistencyRule(
  raw: RawInput,
  knownKeys: ReadonlySet<string>,
): ValidationResult<ConsistencyRuleValue, RuleField> {
  const errors: Partial<Record<RuleField, string>> = {};
  const lhs = text(raw, 'lhs_key');
  const rhs = text(raw, 'rhs_key');
  const operator = text(raw, 'operator') as ConsistencyOperator;
  const message = text(raw, 'message');
  if (!knownKeys.has(lhs)) errors.lhs_key = 'Choose a recorded value.';
  if (!knownKeys.has(rhs)) errors.rhs_key = 'Choose a recorded value.';
  else if (lhs === rhs) errors.rhs_key = 'Compare two different values.';
  if (!CONSISTENCY_OPERATORS.includes(operator)) errors.operator = 'Choose a comparison.';
  if (!message) errors.message = 'Enter the message the technician will see.';
  else if (message.length > 300) errors.message = 'Keep the message under 300 characters.';
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: { lhs_key: lhs, operator, rhs_key: rhs, message, is_active: ['on', 'true', '1'].includes(text(raw, 'is_active').toLowerCase()) },
  };
}
