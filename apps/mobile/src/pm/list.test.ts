import { describe, expect, it } from 'vitest';
import type { Schedule, Site, Visit } from '@/offline/types';
import { buildPmRows } from './list';

const site = { id: 's1', site_code: '1301', site_name: 'Tienii' } as Site;
const schedule = (id: string, status: Schedule['status'], due: string, tech = 't1') =>
  ({ id, site_id: 's1', template_id: 'tpl', technician_id: tech, status, due_date: due, frequency: 'MONTHLY' }) as Schedule;
const visit = (id: string, status: Visit['status'], scheduleId: string | null) =>
  ({ id, site_id: 's1', template_id: 'tpl', technician_id: 't1', status, schedule_id: scheduleId, completion_pct: 50, review_comments: null }) as Visit;

describe('buildPmRows', () => {
  it('lists open schedules, attaches started visits and adds unscheduled work', () => {
    const rows = buildPmRows(
      [schedule('a', 'SCHEDULED', '2026-10-01'), schedule('b', 'IN_PROGRESS', '2026-09-20'), schedule('c', 'APPROVED', '2026-09-01'), schedule('x', 'SCHEDULED', '2026-09-01', 't2')],
      [visit('vb', 'IN_PROGRESS', 'b'), visit('vu', 'SUBMITTED', null)],
      [site],
      't1',
      new Set(['vu']),
    );
    expect(rows.map((r) => [r.key, r.status, r.visitId, r.waitingToSend])).toEqual([
      ['s-b', 'IN_PROGRESS', 'vb', false],
      ['s-a', 'SCHEDULED', null, false],
      ['v-vu', 'SUBMITTED', 'vu', true],
    ]);
    expect(rows[0]).toMatchObject({ siteCode: '1301', siteName: 'Tienii', completion: 50 });
  });
});
