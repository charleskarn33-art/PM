import { afterAll, describe, expect, it } from 'vitest';
import { actAs, getPool, ids, inTx, tryQuery } from './db';

afterAll(async () => {
  await getPool().end();
});

describe('schema integrity', () => {
  it('enables RLS on every table in public', async () => {
    const { rows } = await getPool().query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it('gives the anon role no privileges on public tables', async () => {
    const { rows } = await getPool().query<{ table_name: string }>(
      `select distinct table_name from information_schema.role_table_grants
        where grantee = 'anon' and table_schema = 'public'`,
    );
    expect(rows).toEqual([]);
    await inTx(async (c) => {
      await actAs(c, 'anon');
      const res = await tryQuery(c, 'select * from public.sites');
      expect(res.error?.code).toBe('42501');
    });
  });

  it('every public table except lookup/append-only tables has audit timestamps', async () => {
    const { rows } = await getPool().query<{ table_name: string }>(
      `select t.table_name from information_schema.tables t
        where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
          and not exists (select 1 from information_schema.columns c
                           where c.table_schema = 'public' and c.table_name = t.table_name
                             and c.column_name = 'created_at')`,
    );
    expect(rows.map((r) => r.table_name).sort()).toEqual(['roles']);
  });

  it('derives region and cluster from county on sites', async () => {
    const { rows } = await getPool().query(
      `select region_id, cluster_id from public.sites where id = $1`,
      [ids.siteA1],
    );
    // Fixture inserted siteA1 with the WRONG region; the trigger corrected it.
    expect(rows[0]).toEqual({ region_id: ids.regionA, cluster_id: '20000000-0000-4000-8000-00000000000a' });
  });

  it('creates an inactive viewer profile for new auth users', async () => {
    await inTx(async (c) => {
      const { rows } = await c.query(
        `insert into auth.users (email, raw_user_meta_data)
         values ('new.person@test.local', '{"full_name":"New Person"}') returning id`,
      );
      const profile = await c.query(`select role, is_active, full_name from public.profiles where id = $1`, [
        rows[0].id,
      ]);
      expect(profile.rows[0]).toEqual({ role: 'viewer', is_active: false, full_name: 'New Person' });
    });
  });

  it('stores DC kW as a calculated column without touching measured values', async () => {
    await inTx(async (c) => {
      const tpl = await c.query(`select id from public.pm_templates where status = 'ACTIVE'`);
      const visit = await c.query(
        `insert into public.pm_visits (site_id, template_id, technician_id) values ($1, $2, $3) returning id`,
        [ids.siteA1, tpl.rows[0].id, ids.techA],
      );
      const { rows } = await c.query(
        `insert into public.dc_readings (visit_id, site_id, recorded_at, rectifier_voltage_v, load_current_a)
         values ($1, $2, now(), 53.5, 42) returning rectifier_voltage_v, load_current_a, dc_power_kw`,
        [visit.rows[0].id, ids.siteA1],
      );
      expect(rows[0].rectifier_voltage_v).toBe('53.5');
      expect(rows[0].load_current_a).toBe('42');
      expect(Number(rows[0].dc_power_kw)).toBeCloseTo(2.247, 10);
      const updated = await c.query(
        `update public.dc_readings set load_current_a = 40 where visit_id = $1 returning dc_power_kw`,
        [visit.rows[0].id],
      );
      expect(Number(updated.rows[0].dc_power_kw)).toBeCloseTo(2.14, 10);
    });
  });
});

describe('reference PM template (Tienii 1301 structure)', () => {
  it('has the six reference sections in order', async () => {
    const { rows } = await getPool().query<{ name: string }>(
      `select s.name from public.pm_sections s join public.pm_templates t on t.id = s.template_id
        where t.status = 'ACTIVE' order by s.sort_order`,
    );
    expect(rows.map((r) => r.name)).toEqual([
      'Generator',
      'DC System',
      'Battery',
      'Solar',
      'Non-Technical Observations',
      'Earthing / Grounding',
    ]);
  });

  it('has the expected checklist items and readings per section', async () => {
    const { rows } = await getPool().query<{ code: string; items: string; readings: string }>(
      `select s.code,
              (select count(*) from public.pm_checklist_items i where i.section_id = s.id) as items,
              (select count(*) from public.pm_reading_fields f where f.section_id = s.id) as readings
         from public.pm_sections s order by s.sort_order`,
    );
    expect(rows).toEqual([
      { code: 'GENERATOR', items: '16', readings: '4' },
      { code: 'DC_SYSTEM', items: '15', readings: '6' },
      { code: 'BATTERY', items: '8', readings: '3' },
      { code: 'SOLAR', items: '12', readings: '3' },
      { code: 'NON_TECHNICAL', items: '13', readings: '0' },
      { code: 'EARTHING', items: '5', readings: '0' },
    ]);
  });

  it('models clamp-meter phases as numeric amp fields with a phase number', async () => {
    const { rows } = await getPool().query(
      `select response_type, unit, (metadata->>'phase_number')::int as phase
         from public.pm_checklist_items where code like 'dc_phase_%' order by sort_order`,
    );
    expect(rows).toHaveLength(7);
    rows.forEach((r, i) => expect(r).toEqual({ response_type: 'NUMBER', unit: 'A', phase: i + 1 }));
  });

  it('configures the evidence rules called out in the requirements', async () => {
    const { rows } = await getPool().query(
      `select code, creates_failure_on_yes, creates_failure_on_no,
              requires_photo_on_answer::text[] as photo_on, requires_comment_on_answer::text[] as comment_on
         from public.pm_checklist_items
        where code in ('gen_burning_oil', 'bat_water_top_up', 'nt_fire_extinguisher')
        order by code`,
    );
    expect(rows).toEqual([
      { code: 'bat_water_top_up', creates_failure_on_yes: false, creates_failure_on_no: false, photo_on: [], comment_on: ['YES'] },
      { code: 'gen_burning_oil', creates_failure_on_yes: true, creates_failure_on_no: false, photo_on: [], comment_on: [] },
      { code: 'nt_fire_extinguisher', creates_failure_on_yes: false, creates_failure_on_no: true, photo_on: ['YES'], comment_on: [] },
    ]);
  });

  it('seeds Tienii (1301) as flagged demo data only', async () => {
    const { rows } = await getPool().query(
      `select s.site_name, s.is_demo, r.name as region from public.sites s
         join public.regions r on r.id = s.region_id where s.site_code = '1301'`,
    );
    expect(rows).toEqual([{ site_name: 'Tienii', is_demo: true, region: 'Grand Cape Mount' }]);
  });
});
