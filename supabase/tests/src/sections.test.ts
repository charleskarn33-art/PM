import { afterAll, describe, expect, it } from 'vitest';
import { actAs, createVisitAs, getPool, ids, inTx, itemId, tryQuery, type Client } from './db';

afterAll(async () => {
  await getPool().end();
});

async function reading(c: Client, visitId: string, code: string, value: number | string | null) {
  const col = typeof value === 'string' ? 'text_value' : 'numeric_value';
  await c.query(
    `insert into public.pm_readings (visit_id, reading_field_id, label_snapshot, ${col})
     select $1, f.id, '', $3 from public.pm_reading_fields f
       join public.pm_sections s on s.id = f.section_id
       join public.pm_templates t on t.id = s.template_id and t.status = 'ACTIVE'
      where f.code = $2
     on conflict (visit_id, reading_field_id) do update set ${col} = excluded.${col}`,
    [visitId, code, value],
  );
}

async function answer(c: Client, visitId: string, code: string, values: Record<string, unknown>) {
  const cols = Object.keys(values);
  await c.query(
    `insert into public.pm_responses (visit_id, checklist_item_id, prompt_snapshot, ${cols.join(', ')})
     values ($1, $2, '', ${cols.map((_, i) => `$${i + 3}`).join(', ')})
     on conflict (visit_id, checklist_item_id) do update set ${cols.map((k) => `${k} = excluded.${k}`).join(', ')}`,
    [visitId, await itemId(c, code), ...Object.values(values)],
  );
}

describe('section analytics projection', () => {
  it('projects generator readings and service answers', async () => {
    await inTx(async (c) => {
      const visitId = await createVisitAs(c, ids.techA, ids.siteA1);
      await reading(c, visitId, 'running_hours', 15234);
      await reading(c, visitId, 'fuel_level', 62.5);
      await answer(c, visitId, 'gen_engine_oil_change', { answer: 'YES' });
      await answer(c, visitId, 'gen_fuel_filter_change', { answer: 'NO' });
      await answer(c, visitId, 'gen_oil_filter_change', { answer: 'N/A' });
      const { rows } = await c.query(
        `select site_id, running_hours::float, fuel_level_pct::float, oil_pressure_bar, engine_oil_changed,
                fuel_filter_changed, oil_filter_changed from public.generator_readings where visit_id = $1`,
        [visitId],
      );
      expect(rows).toEqual([
        {
          site_id: ids.siteA1,
          running_hours: 15234,
          fuel_level_pct: 62.5,
          oil_pressure_bar: null,
          engine_oil_changed: true,
          fuel_filter_changed: false,
          oil_filter_changed: null,
        },
      ]);
    });
  });

  it('projects DC readings with calculated kW and per-phase currents', async () => {
    await inTx(async (c) => {
      const visitId = await createVisitAs(c, ids.techA, ids.siteA1);
      await reading(c, visitId, 'rectifier_output_voltage', 53.6);
      await reading(c, visitId, 'load_current', 41.5);
      await reading(c, visitId, 'controller_model', 'NCU');
      await answer(c, visitId, 'dc_phase_1_amps', { numeric_value: 12.4, comment: 'Clamp on BLVD' });
      await answer(c, visitId, 'dc_phase_3_amps', { numeric_value: 9.1 });

      const dc = await c.query(
        `select rectifier_voltage_v::float as v, load_current_a::float as a, dc_power_kw::float as kw, controller_model
           from public.dc_readings where visit_id = $1`,
        [visitId],
      );
      expect(dc.rows[0]).toMatchObject({ v: 53.6, a: 41.5, controller_model: 'NCU' });
      expect(dc.rows[0].kw).toBeCloseTo((53.6 * 41.5) / 1000, 10);

      const phases = async () =>
        (await c.query(
          `select phase_number, amp_value::float as amps, unit, comment from public.dc_phase_currents where visit_id = $1 order by 1`,
          [visitId],
        )).rows;
      expect(await phases()).toEqual([
        { phase_number: 1, amps: 12.4, unit: 'A', comment: 'Clamp on BLVD' },
        { phase_number: 3, amps: 9.1, unit: 'A', comment: null },
      ]);

      // Clearing a phase removes it; the measured load current is untouched.
      await answer(c, visitId, 'dc_phase_3_amps', { numeric_value: null });
      expect((await phases()).map((p) => p.phase_number)).toEqual([1]);
      const raw = await c.query(
        `select numeric_value::float from public.pm_readings r join public.pm_reading_fields f on f.id = r.reading_field_id
          where r.visit_id = $1 and f.code = 'load_current'`,
        [visitId],
      );
      expect(raw.rows[0].numeric_value).toBe(41.5);
    });
  });

  it('projects battery, solar and earthing, and clears a section marked N/A', async () => {
    await inTx(async (c) => {
      const visitId = await createVisitAs(c, ids.techA, ids.siteA1);
      await reading(c, visitId, 'battery_voltage', 52.9);
      await answer(c, visitId, 'bat_water_top_up', { answer: 'YES', comment: 'Topped up' });
      await reading(c, visitId, 'panels_installed', 12);
      await answer(c, visitId, 'sol_damaged_panel_count', { numeric_value: 1 });
      await answer(c, visitId, 'earth_abnormalities', { answer: 'NO' });

      const one = async (table: string) => (await c.query(`select * from public.${table} where visit_id = $1`, [visitId])).rows[0];
      expect(await one('battery_readings')).toMatchObject({ water_top_up_required: true });
      expect(await one('solar_readings')).toMatchObject({ panels_installed: 12, damaged_panel_count: 1 });
      expect(await one('earthing_readings')).toMatchObject({ abnormalities_found: false });

      await c.query(`update public.pm_visits set not_applicable_sections = '{SOLAR}' where id = $1`, [visitId]);
      expect(await one('solar_readings')).toBeUndefined();
      expect(await one('battery_readings')).toBeDefined();
    });
  });

  it('analytics rows follow visit visibility', async () => {
    await inTx(async (c) => {
      const visitId = await createVisitAs(c, ids.techA, ids.siteA1);
      await reading(c, visitId, 'rectifier_output_voltage', 54);
      for (const [user, visible] of [
        [ids.techA, 1],
        [ids.supervisorA, 1],
        [ids.techB, 0],
        [ids.supervisorB, 0],
      ] as const) {
        await actAs(c, user);
        expect((await c.query(`select 1 from public.dc_readings where visit_id = $1`, [visitId])).rowCount, user).toBe(visible);
      }
      await actAs(c, ids.techA);
      const write = await tryQuery(c, `update public.dc_readings set rectifier_voltage_v = 1 where visit_id = $1`, [visitId]);
      expect(write.error?.code).toBe('42501');
    });
  });
});

describe('site equipment drives default N/A sections', () => {
  it('marks sections for missing equipment N/A, which the technician can switch back on', async () => {
    await inTx(async (c) => {
      await actAs(c, ids.admin);
      await c.query(`insert into public.site_assignments (site_id, technician_id) values ($1, $2)`, [ids.siteA2, ids.techA]);
      const visitId = await createVisitAs(c, ids.techA, ids.siteA2);
      const na = async () =>
        (await c.query(`select not_applicable_sections from public.pm_visits where id = $1`, [visitId])).rows[0]
          .not_applicable_sections;
      expect(await na()).toEqual(['GENERATOR', 'BATTERY', 'SOLAR']);
      await c.query(`update public.pm_visits set not_applicable_sections = '{BATTERY,SOLAR}' where id = $1`, [visitId]);
      expect(await na()).toEqual(['BATTERY', 'SOLAR']);

      const full = await createVisitAs(c, ids.techA, ids.siteA1);
      expect((await c.query(`select not_applicable_sections from public.pm_visits where id = $1`, [full])).rows[0].not_applicable_sections).toEqual([]);
    });
  });
});

describe('consistency rules', () => {
  it('flag values that contradict each other and block submission', async () => {
    await inTx(async (c) => {
      const visitId = await createVisitAs(c, ids.techA, ids.siteA1);
      await reading(c, visitId, 'dc_modules_installed', 4);
      await reading(c, visitId, 'dc_modules_operational', 5);
      const issues = async () =>
        (await c.query(`select section_code, label from public.pm_visit_issues($1) where issue = 'INCONSISTENT'`, [visitId])).rows;
      expect(await issues()).toEqual([{ section_code: 'DC_SYSTEM', label: 'DC Modules Operational cannot exceed DC Modules Installed.' }]);

      await reading(c, visitId, 'dc_modules_operational', 4);
      expect(await issues()).toEqual([]);

      await reading(c, visitId, 'panels_installed', 10);
      await answer(c, visitId, 'sol_damaged_panel_count', { numeric_value: 11 });
      expect((await issues()).map((i) => i.section_code)).toEqual(['SOLAR']);
      await c.query(`update public.pm_visits set not_applicable_sections = '{SOLAR}' where id = $1`, [visitId]);
      expect(await issues()).toEqual([]);
    });
  });

  it('are admin-managed data', async () => {
    await inTx(async (c) => {
      await actAs(c, ids.supervisorA);
      expect((await c.query(`select count(*)::int as n from public.pm_consistency_rules`)).rows[0].n).toBe(3);
      const write = await tryQuery(c, `update public.pm_consistency_rules set is_active = false`);
      expect(write.rowCount).toBe(0);
      await actAs(c, ids.admin);
      expect((await tryQuery(c, `update public.pm_consistency_rules set is_active = false`)).rowCount).toBe(3);
    });
  });
});
