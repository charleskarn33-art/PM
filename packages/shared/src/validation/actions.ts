import type { Enums } from '../database.types';
import { isUuid, text, type RawInput, type ValidationResult } from './common';

export const PRIORITIES: readonly Enums<'priority_level'>[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
export const SEVERITIES: readonly Enums<'severity_level'>[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
export const PM_CATEGORIES: readonly Enums<'pm_category'>[] = ['GENERATOR', 'DC_SYSTEM', 'BATTERY', 'SOLAR', 'NON_TECHNICAL', 'EARTHING'];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TEXT = 2000;

function validDate(v: string): boolean {
  if (!ISO_DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export interface CorrectiveActionValue {
  description: string;
  priority: Enums<'priority_level'>;
  assigned_to: string | null;
  due_date: string | null;
}
type ActionField = keyof CorrectiveActionValue;

/** Create / edit a corrective action. Assignee and due date are optional. */
export function validateCorrectiveAction(raw: RawInput): ValidationResult<CorrectiveActionValue, ActionField> {
  const errors: Partial<Record<ActionField, string>> = {};
  const description = text(raw, 'description');
  if (!description) errors.description = 'Describe the work to be done.';
  else if (description.length > MAX_TEXT) errors.description = `Keep it under ${MAX_TEXT} characters.`;
  const priority = text(raw, 'priority') as Enums<'priority_level'>;
  if (!PRIORITIES.includes(priority)) errors.priority = 'Choose a priority.';
  const assigned = text(raw, 'assigned_to');
  if (assigned && !isUuid(assigned)) errors.assigned_to = 'Choose a person.';
  const due = text(raw, 'due_date');
  if (due && !validDate(due)) errors.due_date = 'Enter a valid date.';
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { description, priority, assigned_to: assigned || null, due_date: due || null } };
}

export interface ManualFailureValue {
  site_id: string;
  category: Enums<'pm_category'>;
  severity: Enums<'severity_level'>;
  description: string;
}
type FailureField = keyof ManualFailureValue;

export function validateManualFailure(raw: RawInput): ValidationResult<ManualFailureValue, FailureField> {
  const errors: Partial<Record<FailureField, string>> = {};
  const site = text(raw, 'site_id');
  if (!isUuid(site)) errors.site_id = 'Choose a site.';
  const category = text(raw, 'category') as Enums<'pm_category'>;
  if (!PM_CATEGORIES.includes(category)) errors.category = 'Choose a category.';
  const severity = text(raw, 'severity') as Enums<'severity_level'>;
  if (!SEVERITIES.includes(severity)) errors.severity = 'Choose a severity.';
  const description = text(raw, 'description');
  if (!description) errors.description = 'Describe the failure.';
  else if (description.length > MAX_TEXT) errors.description = `Keep it under ${MAX_TEXT} characters.`;
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { site_id: site, category, severity, description } };
}

/** A required free-text note (closing reason, return reason, resolution). */
export function requiredNote(raw: RawInput, key: string, min = 3): { ok: true; value: string } | { ok: false; error: string } {
  const v = text(raw, key);
  if (v.length < min) return { ok: false, error: `Enter at least ${min} characters.` };
  if (v.length > MAX_TEXT) return { ok: false, error: `Keep it under ${MAX_TEXT} characters.` };
  return { ok: true, value: v };
}

/** Default priority for an action raised from a failure: its severity (same scale). */
export function priorityForSeverity(severity: Enums<'severity_level'>): Enums<'priority_level'> {
  return severity;
}
