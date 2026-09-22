import type { Enums } from '../database.types';
import { addDays, MAX_OCCURRENCES, occurrenceDates } from '../pm/recurrence';
import { isUuid, optionalText, text, type FieldErrors, type RawInput, type ValidationResult } from './common';

const FREQUENCIES: readonly Enums<'pm_frequency'>[] = [
  'WEEKLY',
  'BIWEEKLY',
  'MONTHLY',
  'BIMONTHLY',
  'QUARTERLY',
  'SEMIANNUAL',
  'ANNUAL',
  'AD_HOC',
];
const PRIORITIES: readonly Enums<'priority_level'>[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export interface ScheduleOccurrence {
  scheduled_date: string;
  due_date: string;
}

export interface ScheduleInput {
  site_id: string;
  technician_id: string | null;
  frequency: Enums<'pm_frequency'>;
  priority: Enums<'priority_level'>;
  notes: string | null;
  occurrences: ScheduleOccurrence[];
}

/**
 * New PM schedule(s): start date, number of occurrences at the chosen
 * frequency, and a due window (days after each scheduled date).
 */
export function validateSchedule(raw: RawInput): ValidationResult<ScheduleInput> {
  const errors: FieldErrors<string> = {};
  const site_id = text(raw, 'site_id');
  const technician_id = optionalText(raw, 'technician_id');
  const frequency = text(raw, 'frequency') as Enums<'pm_frequency'>;
  const priority = (text(raw, 'priority') || 'MEDIUM') as Enums<'priority_level'>;
  const start = text(raw, 'start_date');
  const count = Number(text(raw, 'occurrences') || '1');
  const dueDays = Number(text(raw, 'due_days') || '0');

  if (!isUuid(site_id)) errors.site_id = 'Select a site.';
  if (technician_id !== null && !isUuid(technician_id)) errors.technician_id = 'Invalid technician.';
  if (!FREQUENCIES.includes(frequency)) errors.frequency = 'Select a frequency.';
  if (!PRIORITIES.includes(priority)) errors.priority = 'Invalid priority.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || Number.isNaN(Date.parse(start))) errors.start_date = 'Enter a valid start date.';
  if (!Number.isInteger(count) || count < 1 || count > MAX_OCCURRENCES) {
    errors.occurrences = `Occurrences must be between 1 and ${MAX_OCCURRENCES}.`;
  }
  if (!Number.isInteger(dueDays) || dueDays < 0 || dueDays > 90) errors.due_days = 'Due window must be 0–90 days.';
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      site_id,
      technician_id,
      frequency,
      priority,
      notes: optionalText(raw, 'notes'),
      occurrences: occurrenceDates(frequency, start, count).map((d) => ({ scheduled_date: d, due_date: addDays(d, dueDays) })),
    },
  };
}
