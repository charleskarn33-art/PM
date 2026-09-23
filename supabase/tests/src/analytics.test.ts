import { afterAll, describe, expect, it } from 'vitest';
import { actAs, activeTemplateId, getPool, ids, inTx, itemId, relaxRequirements, type Client } from './db';

afterAll(async () => {
  await getPool().end();
});

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysFromNow = (n: number) => iso(new Date(Date.now() + n * 86_400_000));

async function schedule(c: Client, due: string, siteId = ids.siteA1, tech = ids.techA): Promise<string> {
  await actAs(c, ids.admin);
  return (
    await c.query(
      `insert into public.pm_schedules (site_id, template_id, technician_id, scheduled_date, due_date, frequency)
       values ($1, $2, $3, $4::date - 5, $4::date, 'MONTHLY') returning id`,
      [siteId, await activeTemplateId(c), tech, due],
    )
  ).rows[0].id;
}

/** tech.a completes and submits the PM for a schedule, optionally answering items as failing. */
async function submit(c: Client, scheduleId: string, failing: string[] = [], readings: Record<string, number> = {}) {
  await relaxRequirements(c);
  await actAs(c, ids.techA);
  const visitId = (
    await c.query(
      `insert into public.pm_visits (site_id, template_id, technician_id, schedule_id, status, started_at, ended_at, gps_latitude, gps_longitude)
       values ($1, $2, $3, $4, 'IN_PROGRESS', now() - interval '90 minutes', now() - interval '30 minutes', 7.0, -11.0) returning id`,
      [ids.siteA1, await activeTemplateId(c), ids.techA, scheduleId],
    )
  ).rows[0].id;
  for (const code of failing) {
    await c.query(`insert into public.pm_responses (visit_id, checklist_item_id, prompt_snapshot, answer) values ($1, $2, '', 'NO')`, [visitId, await itemId(c, code)]);
  }
  for (const [code, value] of Object.entries(readings)) {
    await c.query(
      `insert into public.pm_readings (visit_id, reading_field_id, label_snapshot, numeric_value)
       select $1, f.id, '', $3 from public.pm_reading_fields f join public.pm_sections s on s.id = f.section_id
         join public.pm_templates t on t.id = s.template_id and t.status = 'ACTIVE' where f.code = $2`,
      [visitId, code, value],
    );
  }
  await c.query(`update public.pm_visits set status = 'SUBMITTED' where id = $1`, [visitId]);
  return visitId;
}

describe('analytics', () => {
  it('PM compliance counts scheduled, completed, on-time and overdue within the caller’s scope', async () => {
    await inTx(async (c) => {
      const onTime = await schedule(c, daysFromNow(3));
      await schedule(c, daysFromNow(-2)); // overdue, not done
      await schedule(c, daysFromNow(10)); // pending
      await submit(c, onTime);
      const from = daysFromNow(-10);
      const to = daysFromNow(20);

      await actAs(c, ids.supervisorA);
      const byRegion = await c.query(`select * from public.analytics_pm_compliance($1, $2, 'region')`, [from, to]);
      expect(byRegion.rows).toEqual([
        { group_key: ids.regionA, group_label: 'Region A', scheduled: 3, completed: 1, on_time: 1, overdue: 1 },
      ]);
      const byTech = await c.query(`select group_label, scheduled from public.analytics_pm_compliance($1, $2, 'technician')`, [from, to]);
      expect(byTech.rows).toEqual([{ group_label: 'tech.a', scheduled: 3 }]);
      const byMonth = await c.query(`select sum(scheduled)::int as n from public.analytics_pm_compliance($1, $2, 'month')`, [from, to]);
      expect(byMonth.rows[0].n).toBe(3);

      // Another region's supervisor sees none of it; an unknown grouping returns nothing.
      await actAs(c, ids.supervisorB);
      expect((await c.query(`select * from public.analytics_pm_compliance($1, $2, 'region')`, [from, to])).rowCount).toBe(0);
      await actAs(c, ids.admin);
      expect((await c.query(`select * from public.analytics_pm_compliance($1, $2, 'bogus')`, [from, to])).rowCount).toBe(0);
      expect((await c.query(`select * from public.analytics_pm_compliance($1, $2, 'region', $3)`, [from, to, ids.regionB])).rowCount).toBe(0);
    });
  });

  it('failures by category, severity and item, with resolution time only for resolved ones', async () => {
    await inTx(async (c) => {
      const s = await schedule(c, daysFromNow(1));
      const visitId = await submit(c, s, ['gen_radiator', 'gen_solenoid']);
      await actAs(c, ids.supervisorA);
      const f = (await c.query(`select id from public.failures where visit_id = $1 order by failure_number limit 1`, [visitId])).rows[0].id;
      const ca = (await c.query(`insert into public.corrective_actions (failure_id, site_id, category, description, assigned_to) values ($1, $2, 'GENERATOR', 'Fix', $3) returning id`, [f, ids.siteA1, ids.techA])).rows[0].id;
      await actAs(c, ids.techA);
      await c.query(`update public.corrective_actions set status = 'COMPLETED', resolution = 'Fixed it' where id = $1`, [ca]);

      await actAs(c, ids.supervisorA);
      const from = daysFromNow(-1);
      const to = daysFromNow(1);
      const byCategory = await c.query(`select group_key, total, open, critical, avg_resolution_hours from public.analytics_failures($1, $2, 'category')`, [from, to]);
      expect(byCategory.rows).toHaveLength(1);
      expect(byCategory.rows[0]).toMatchObject({ group_key: 'GENERATOR', total: 2, open: 2, critical: 0 });
      // One of the two is resolved (its action completed): the average covers that one only.
      expect(byCategory.rows[0].avg_resolution_hours).not.toBeNull();
      const bySeverity = await c.query(`select group_key, total from public.analytics_failures($1, $2, 'severity')`, [from, to]);
      expect(bySeverity.rows).toEqual([{ group_key: 'MEDIUM', total: 2 }]);
      const byItem = await c.query(`select group_label, total from public.analytics_failures($1, $2, 'item') order by 1`, [from, to]);
      expect(byItem.rows.map((r) => r.group_label)).toEqual(['Check Radiator', 'Is the Solenoid Connected & Operational?']);
      await actAs(c, ids.supervisorB);
      expect((await c.query(`select * from public.analytics_failures($1, $2, 'category')`, [from, to])).rowCount).toBe(0);
    });
  });

  it('technician performance and latest equipment readings come only from submitted work', async () => {
    await inTx(async (c) => {
      const s = await schedule(c, daysFromNow(1));
      await submit(c, s, ['gen_radiator'], { rectifier_output_voltage: 53.5, load_current: 40, running_hours: 1200 });
      await actAs(c, ids.supervisorA);
      const techs = await c.query(`select * from public.analytics_technicians($1, $2)`, [daysFromNow(-1), daysFromNow(1)]);
      const a = techs.rows.find((r) => r.technician_id === ids.techA);
      expect(a).toMatchObject({ pm_submitted: 1, pm_approved: 0, pm_awaiting_review: 1, failures_reported: 1 });
      expect(Number(a.avg_pm_minutes)).toBe(60);
      // Inactive technicians are not listed.
      expect(techs.rows.map((r) => r.technician_id)).not.toContain(ids.inactiveTech);

      const latest = await c.query(`select site_code, rectifier_voltage_v, load_current_a, dc_power_kw, running_hours from public.analytics_latest_readings()`);
      expect(latest.rows).toHaveLength(1);
      expect(latest.rows[0].site_code).toBe('T-A1');
      expect(Number(latest.rows[0].dc_power_kw)).toBeCloseTo(2.14, 5);
      expect(Number(latest.rows[0].running_hours)).toBe(1200);

      // A newer PM still in progress does not replace the recorded (submitted) readings.
      await actAs(c, ids.techA);
      const draft = (
        await c.query(
          `insert into public.pm_visits (site_id, template_id, technician_id, status, started_at, gps_latitude, gps_longitude)
           values ($1, $2, $3, 'IN_PROGRESS', now(), 7.0, -11.0) returning id`,
          [ids.siteA1, await activeTemplateId(c), ids.techA],
        )
      ).rows[0].id;
      await c.query(
        `insert into public.pm_readings (visit_id, reading_field_id, label_snapshot, numeric_value)
         select $1, f.id, '', 99 from public.pm_reading_fields f join public.pm_sections s on s.id = f.section_id
           join public.pm_templates t on t.id = s.template_id and t.status = 'ACTIVE' where f.code = 'rectifier_output_voltage'`,
        [draft],
      );
      await actAs(c, ids.supervisorA);
      expect(Number((await c.query(`select rectifier_voltage_v from public.analytics_latest_readings()`)).rows[0].rectifier_voltage_v)).toBe(53.5);
      await actAs(c, ids.supervisorB);
      expect((await c.query(`select * from public.analytics_latest_readings()`)).rowCount).toBe(0);
      await actAs(c, 'anon');
      await expect(c.query(`select * from public.analytics_latest_readings()`)).rejects.toThrow(/permission denied/);
    });
  });
});
