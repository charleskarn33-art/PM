import { describe, expect, it } from 'vitest';
import { auditActionLabel, auditEntityHref, describeAuditEntry } from './audit';

describe('audit log presentation', () => {
  it('shows a status transition as from → to', () => {
    expect(describeAuditEntry('PM_REJECTED', { to: 'REJECTED', from: 'SUBMITTED', site_id: 'x' })).toBe('SUBMITTED → REJECTED');
  });

  it('summarises changes, records, deletions and reports', () => {
    expect(describeAuditEntry('REGION_UPDATE', { changes: { name: { from: 'New Region', to: 'Renamed' }, is_active: { from: true, to: false } } })).toBe(
      'name: New Region → Renamed; is active: true → false',
    );
    expect(describeAuditEntry('REGION_INSERT', { record: { code: 'NEW', name: 'New Region', region_id: 'x' } })).toBe('code: NEW; name: New Region');
    expect(describeAuditEntry('SITE_DELETE', { deleted: { site_code: '1301', site_name: 'Tienii' } })).toBe('Deleted 1301');
    expect(describeAuditEntry('REPORT_GENERATED', { report: 'pm_visit_pdf', rows: 1 })).toBe('PM visit PDF, 1 row(s)');
    expect(describeAuditEntry('REPORT_GENERATED', { report: 'failures_csv', rows: 8 })).toBe('Failures CSV, 8 row(s)');
    expect(describeAuditEntry('LOGIN', { client: 'mobile' })).toBe('Signed in (mobile)');
    expect(describeAuditEntry('REGION_UPDATE', { changed: ['name'] })).toBe('Changed: name'); // entries written before Phase 8
    expect(describeAuditEntry('X', null)).toBe('');
  });
  it('links to the record unless it was deleted', () => {
    expect(auditEntityHref('failures', 'f1', 'FAILURE_UPDATE')).toBe('/failures/f1');
    expect(auditEntityHref('failures', 'f1', 'FAILURE_DELETE')).toBeNull();
    expect(auditEntityHref('regions', 'r1', 'REGION_UPDATE')).toBeNull();
  });
  it('labels actions in plain words', () => {
    expect(auditActionLabel('SITE_ASSIGNMENT_INSERT')).toBe('Site assignment created');
    expect(auditActionLabel('USER_ROLE_CHANGED')).toBe('User role changed');
    expect(auditActionLabel('PM_REJECTED')).toBe('PM rejected');
    expect(auditActionLabel('PM_SECTION_INSERT')).toBe('PM section created');
  });
});
