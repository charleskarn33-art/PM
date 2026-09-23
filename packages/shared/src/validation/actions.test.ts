import { describe, expect, it } from 'vitest';
import { requiredNote, validateCorrectiveAction, validateManualFailure } from './actions';

const UUID = '50000000-0000-4000-8000-000000000006';

describe('corrective action validation', () => {
  it('accepts optional assignee and due date', () => {
    expect(validateCorrectiveAction({ description: ' Replace hose ', priority: 'HIGH', assigned_to: '', due_date: '' })).toEqual({
      ok: true,
      value: { description: 'Replace hose', priority: 'HIGH', assigned_to: null, due_date: null },
    });
    expect(validateCorrectiveAction({ description: 'x', priority: 'LOW', assigned_to: UUID, due_date: '2026-10-31' }).ok).toBe(true);
  });
  it('rejects bad input', () => {
    const r = validateCorrectiveAction({ description: '', priority: 'URGENT', assigned_to: 'bob', due_date: '2026-02-30' });
    expect(!r.ok && Object.keys(r.errors).sort()).toEqual(['assigned_to', 'description', 'due_date', 'priority']);
  });
});

describe('manual failure validation', () => {
  it('requires site, category, severity and description', () => {
    expect(validateManualFailure({ site_id: UUID, category: 'DC_SYSTEM', severity: 'HIGH', description: 'Rectifier alarm' }).ok).toBe(true);
    const r = validateManualFailure({ site_id: '', category: 'ROOF', severity: '', description: ' ' });
    expect(!r.ok && Object.keys(r.errors).sort()).toEqual(['category', 'description', 'severity', 'site_id']);
  });
  it('notes need some text', () => {
    expect(requiredNote({ note: ' ok ' }, 'note', 2)).toEqual({ ok: true, value: 'ok' });
    expect(requiredNote({ note: 'a' }, 'note').ok).toBe(false);
  });
});
