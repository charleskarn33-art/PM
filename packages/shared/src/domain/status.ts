import type { Enums } from '../database.types';

/**
 * Status colour language used by web and mobile:
 *   success = GREEN (completed / normal)   warning = AMBER (warning / pending)
 *   danger  = RED (failure / critical)     info    = BLUE (in progress)
 *   neutral = GRAY (N/A, cancelled)
 */
export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export const PM_STATUS_TONE: Record<Enums<'pm_status'>, StatusTone> = {
  SCHEDULED: 'warning',
  IN_PROGRESS: 'info',
  COMPLETED: 'success',
  SUBMITTED: 'info',
  APPROVED: 'success',
  REJECTED: 'danger',
  OVERDUE: 'danger',
  CANCELLED: 'neutral',
};

export const FAILURE_STATUS_TONE: Record<Enums<'failure_status'>, StatusTone> = {
  OPEN: 'danger',
  ASSIGNED: 'warning',
  IN_PROGRESS: 'info',
  RESOLVED: 'success',
  VERIFIED: 'success',
  CLOSED: 'neutral',
};

export const CORRECTIVE_ACTION_STATUS_TONE: Record<Enums<'corrective_action_status'>, StatusTone> = {
  OPEN: 'danger',
  ASSIGNED: 'warning',
  IN_PROGRESS: 'info',
  COMPLETED: 'success',
  VERIFIED: 'success',
  CLOSED: 'neutral',
};

export const SEVERITY_TONE: Record<Enums<'severity_level'>, StatusTone> = {
  LOW: 'neutral',
  MEDIUM: 'warning',
  HIGH: 'danger',
  CRITICAL: 'danger',
};

export const ANSWER_TONE: Record<Enums<'yes_no_na'>, StatusTone> = {
  YES: 'success',
  NO: 'danger',
  'N/A': 'neutral',
};

/** "IN_PROGRESS" -> "In Progress" */
export function humanizeStatus(status: string): string {
  if (status === 'N/A') return status;
  return status
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export const PM_CATEGORY_LABELS: Record<Enums<'pm_category'>, string> = {
  GENERATOR: 'Generator',
  DC_SYSTEM: 'DC System',
  BATTERY: 'Battery',
  SOLAR: 'Solar',
  NON_TECHNICAL: 'Non-Technical Observations',
  EARTHING: 'Earthing / Grounding',
};
