import { describe, expect, it } from 'vitest';
import { dcPowerKw, totalPhaseCurrentA } from './dc';
import { can, isMobileRole, ROLE_LABELS } from './roles';
import { isPmOverdue, toIsoDate } from './schedule';
import { humanizeStatus, PM_STATUS_TONE } from './status';
import { Constants } from '../database.types';

describe('dcPowerKw', () => {
  it('computes V x I / 1000', () => {
    expect(dcPowerKw(53.5, 42)).toBeCloseTo(2.247, 10);
    expect(dcPowerKw(48, 0)).toBe(0);
  });
  it('returns null for missing or invalid measurements', () => {
    expect(dcPowerKw(null, 10)).toBeNull();
    expect(dcPowerKw(54, undefined)).toBeNull();
    expect(dcPowerKw(Number.NaN, 10)).toBeNull();
    expect(dcPowerKw(54, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('totalPhaseCurrentA', () => {
  it('sums recorded phases and ignores blanks', () => {
    expect(totalPhaseCurrentA([10.5, null, 4, undefined, 0])).toBeCloseTo(14.5, 10);
  });
  it('returns null when nothing was recorded', () => {
    expect(totalPhaseCurrentA([null, undefined])).toBeNull();
    expect(totalPhaseCurrentA([])).toBeNull();
  });
});

describe('roles', () => {
  it('has a label for every database role', () => {
    expect(Object.keys(ROLE_LABELS).sort()).toEqual([...Constants.public.Enums.app_role].sort());
  });
  it('grants capabilities per role', () => {
    expect(can('super_admin', 'manage_templates')).toBe(true);
    expect(can('regional_supervisor', 'review_pm')).toBe(true);
    expect(can('regional_manager', 'review_pm')).toBe(false);
    expect(can('viewer', 'schedule_pm')).toBe(false);
    expect(can('technician', 'perform_pm')).toBe(true);
    expect(can('maintenance', 'perform_pm')).toBe(false);
    expect(can(null, 'view_reports')).toBe(false);
  });
  it('identifies field roles for the mobile app', () => {
    expect(isMobileRole('technician')).toBe(true);
    expect(isMobileRole('maintenance')).toBe(true);
    expect(isMobileRole('viewer')).toBe(false);
    expect(isMobileRole(undefined)).toBe(false);
  });
});

describe('schedule', () => {
  it('flags open PMs past their due date as overdue', () => {
    expect(isPmOverdue('SCHEDULED', '2026-09-14', '2026-09-15')).toBe(true);
    expect(isPmOverdue('IN_PROGRESS', '2026-09-14', '2026-09-15')).toBe(true);
    expect(isPmOverdue('SCHEDULED', '2026-09-15', '2026-09-15')).toBe(false);
    expect(isPmOverdue('APPROVED', '2026-09-01', '2026-09-15')).toBe(false);
    expect(isPmOverdue('OVERDUE', '2026-12-01', '2026-09-15')).toBe(true);
  });
  it('formats local dates', () => {
    expect(toIsoDate(new Date(2026, 8, 5))).toBe('2026-09-05');
  });
});

describe('status helpers', () => {
  it('covers every PM status with a tone', () => {
    expect(Object.keys(PM_STATUS_TONE).sort()).toEqual([...Constants.public.Enums.pm_status].sort());
  });
  it('humanizes enum values', () => {
    expect(humanizeStatus('IN_PROGRESS')).toBe('In Progress');
    expect(humanizeStatus('N/A')).toBe('N/A');
  });
});
