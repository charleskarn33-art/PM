import { afterAll, describe, expect, it } from 'vitest';
import { actAs, activeTemplateId, getPool, ids, inTx, tryQuery } from './db';

afterAll(async () => {
  await getPool().end();
});

describe('assignment and supervisor integrity', () => {
  it('only active technicians can be assigned to a site', async () => {
    await inTx(async (c) => {
      await actAs(c, ids.admin);
      const sql = `insert into public.site_assignments (site_id, technician_id) values ($1, $2)`;
      const inactive = await tryQuery(c, sql, [ids.siteA2, ids.inactiveTech]);
      expect(inactive.error?.message).toMatch(/Only active technicians/);
      const ok = await tryQuery(c, sql, [ids.siteA2, ids.techA]);
      expect(ok.error).toBeUndefined();
    });
  });

  it('an assignment ending in the past becomes inactive and removes access', async () => {
    await inTx(async (c) => {
      await actAs(c, ids.supervisorA);
      const { rows } = await c.query(
        `update public.site_assignments set starts_on = current_date - 30, ends_on = current_date - 1
          where site_id = $1 and technician_id = $2 returning is_active`,
        [ids.siteA1, ids.techA],
      );
      expect(rows[0].is_active).toBe(false);
      await actAs(c, ids.techA);
      expect((await c.query(`select id from public.sites where id = $1`, [ids.siteA1])).rowCount).toBe(0);
    });
  });

  it('site supervisor must be an active regional supervisor', async () => {
    await inTx(async (c) => {
      await actAs(c, ids.admin);
      const bad = await tryQuery(c, `update public.sites set supervisor_id = $2 where id = $1`, [ids.siteA2, ids.techA]);
      expect(bad.error).toBeDefined();
      const ok = await tryQuery(c, `update public.sites set supervisor_id = $2 where id = $1`, [ids.siteA2, ids.supervisorB]);
      expect(ok.error).toBeUndefined();
    });
  });
});

describe('admin_set_region_scopes', () => {
  it('is admin-only, replaces scopes atomically and is audited', async () => {
    await inTx(async (c) => {
      await actAs(c, ids.supervisorA);
      const denied = await tryQuery(c, `select public.admin_set_region_scopes($1, $2)`, [ids.managerA, [ids.regionB]]);
      expect(denied.error?.code).toBe('42501');

      await actAs(c, ids.admin);
      await c.query(`select public.admin_set_region_scopes($1, $2)`, [ids.managerA, [ids.regionA, ids.regionB]]);
      await actAs(c, ids.managerA);
      const sites = await c.query(`select site_code from public.sites where site_code like 'T-%' order by 1`);
      expect(sites.rows.map((r) => r.site_code)).toEqual(['T-A1', 'T-A2', 'T-B1']);

      await actAs(c, ids.admin);
      await c.query(`select public.admin_set_region_scopes($1, $2)`, [ids.managerA, [ids.regionB]]);
      const scopes = await c.query(`select region_id from public.user_region_scopes where profile_id = $1`, [
        ids.managerA,
      ]);
      expect(scopes.rows).toEqual([{ region_id: ids.regionB }]);
      const audit = await c.query(
        `select count(*)::int as n from public.audit_logs where action = 'USER_SCOPE_CHANGED' and entity_id = $1`,
        [ids.managerA],
      );
      expect(audit.rows[0].n).toBe(2);
    });
  });

  it('rejects region scopes for roles that do not use them', async () => {
    await inTx(async (c) => {
      await actAs(c, ids.admin);
      const res = await tryQuery(c, `select public.admin_set_region_scopes($1, $2)`, [ids.techA, [ids.regionA]]);
      expect(res.error?.message).toMatch(/only to Regional Managers and Regional Supervisors/);
    });
  });
});

describe('overview views respect RLS', () => {
  it('site_overview aggregates names, next PM and open issues within scope', async () => {
    await inTx(async (c) => {
      const templateId = await activeTemplateId(c);
      await c.query(
        `insert into public.pm_schedules (site_id, template_id, technician_id, scheduled_date, due_date)
         values ($1, $2, $3, current_date, current_date + 5), ($1, $2, $3, current_date, current_date + 40)`,
        [ids.siteA1, templateId, ids.techA],
      );
      await c.query(
        `insert into public.failures (source, site_id, category, description) values ('MANUAL', $1, 'SOLAR', 'x')`,
        [ids.siteA1],
      );
      await actAs(c, ids.supervisorA);
      const { rows } = await c.query(
        `select site_code, region_name, cluster_name, county_name, supervisor_name, technician_names,
                next_pm_due = current_date + 5 as next_is_nearest, next_pm_status, open_failures
           from public.site_overview where site_code like 'T-%' order by site_code`,
      );
      expect(rows).toEqual([
        {
          site_code: 'T-A1',
          region_name: 'Region A',
          cluster_name: 'Cluster A1',
          county_name: 'County A1',
          supervisor_name: 'supervisor.a',
          technician_names: 'inactive, tech.a',
          next_is_nearest: true,
          next_pm_status: 'SCHEDULED',
          open_failures: 1,
        },
        {
          site_code: 'T-A2',
          region_name: 'Region A',
          cluster_name: null,
          county_name: null,
          supervisor_name: 'supervisor.a',
          technician_names: null,
          next_is_nearest: null,
          next_pm_status: null,
          open_failures: 0,
        },
      ]);
      await actAs(c, ids.techB);
      const tech = await c.query(`select site_code from public.site_overview where site_code like 'T-%'`);
      expect(tech.rows).toEqual([{ site_code: 'T-B1' }]);
    });
  });

  it('technician_overview is limited to the supervisor’s people', async () => {
    await inTx(async (c) => {
      await actAs(c, ids.supervisorA);
      const { rows } = await c.query(
        `select full_name, is_active, assigned_sites, supervisor_name from public.technician_overview order by full_name`,
      );
      expect(rows).toEqual([
        { full_name: 'inactive', is_active: false, assigned_sites: 1, supervisor_name: 'supervisor.a' },
        { full_name: 'tech.a', is_active: true, assigned_sites: 1, supervisor_name: 'supervisor.a' },
      ]);
    });
  });

  it('supervisor_overview lists regions, sites and technicians', async () => {
    await inTx(async (c) => {
      await actAs(c, ids.admin);
      const { rows } = await c.query(
        `select full_name, region_names, county_names, site_count, technician_count
           from public.supervisor_overview order by full_name`,
      );
      expect(rows).toEqual([
        { full_name: 'supervisor.a', region_names: 'Region A', county_names: 'County A1', site_count: 2, technician_count: 2 },
        { full_name: 'supervisor.b', region_names: 'Region B', county_names: null, site_count: 1, technician_count: 1 },
      ]);
    });
  });

  it('views are not readable anonymously', async () => {
    await inTx(async (c) => {
      await actAs(c, 'anon');
      const res = await tryQuery(c, `select * from public.site_overview`);
      expect(res.error?.code).toBe('42501');
    });
  });
});

describe('organisation audit trail', () => {
  it('records generated reports for active users only', async () => {
    await inTx(async (c) => {
      await actAs(c, ids.managerA);
      await c.query(`select public.record_report_generated('sites_csv', '{"region":"x"}', 12)`);
      await actAs(c, ids.inactiveTech);
      const denied = await tryQuery(c, `select public.record_report_generated('sites_csv')`);
      expect(denied.error?.code).toBe('42501');
      await actAs(c, ids.admin);
      const { rows } = await c.query(
        `select actor_id, metadata from public.audit_logs where action = 'REPORT_GENERATED'`,
      );
      expect(rows).toEqual([
        { actor_id: ids.managerA, metadata: { report: 'sites_csv', filters: { region: 'x' }, rows: 12 } },
      ]);
    });
  });

  it('records region changes', async () => {
    await inTx(async (c) => {
      await actAs(c, ids.admin);
      const { rows } = await c.query(`insert into public.regions (code, name) values ('NEW', 'New Region') returning id`);
      await c.query(`update public.regions set name = 'Renamed' where id = $1`, [rows[0].id]);
      const audit = await c.query(
        `select action, metadata from public.audit_logs where entity_id = $1 order by id`,
        [rows[0].id],
      );
      expect(audit.rows).toEqual([
        { action: 'REGION_INSERT', metadata: {} },
        { action: 'REGION_UPDATE', metadata: { changed: ['name'] } },
      ]);
    });
  });
});
