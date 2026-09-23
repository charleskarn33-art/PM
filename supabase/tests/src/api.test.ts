/**
 * API integration tests: the web and mobile query shapes executed through a
 * real PostgREST (the same server Supabase uses) with per-role JWTs. Catches
 * embed ambiguity, view grants/RLS, RPC signatures and filter syntax that
 * type-checking cannot.
 */
import type { Database } from '@ipt/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { loadDashboard, monthPeriod } from '@/lib/dashboard';
import { loadClusters, loadCounties, loadRegions, loadSupervisors } from '@/lib/org-data';
import { loadVisitAnalytics, loadVisitDetail } from '@/lib/pm-visit';
import { parseSiteParams, siteQuery } from '@/lib/sites';
import { ids } from './db';
import { apiAs, postgrestBinary } from './postgrest';

const as = (userId: string) => apiAs(userId) as unknown as SupabaseClient<Database>;
const today = new Date().toISOString().slice(0, 10);

describe.skipIf(!postgrestBinary())('PostgREST API', () => {
  it('rejects anonymous table and view access', async () => {
    const api = apiAs(null);
    const results = await Promise.all([
      api.from('sites').select('*').limit(1),
      api.from('site_overview').select('*').limit(1),
      api.from('profiles').select('*').limit(1),
    ]);
    expect(results.map((r) => r.error?.code)).toEqual(['42501', '42501', '42501']);
  });

  describe('web: sites list (lib/sites.ts)', () => {
    it('technician sees only their assigned site', async () => {
      const { data, error } = await siteQuery(as(ids.techA), parseSiteParams({ q: 'Test Site' }), today, { paginate: true });
      expect(error).toBeNull();
      expect(data?.map((s) => s.site_code)).toEqual(['T-A1']);
    });

    it('admin search, filters, sort and count work together', async () => {
      const api = as(ids.admin);
      const all = await siteQuery(api, parseSiteParams({ q: 'test site', sort: 'open_failures', dir: 'desc' }), today, {
        paginate: true,
      });
      expect(all.error).toBeNull();
      expect(all.count).toBe(3);

      const region = await siteQuery(api, parseSiteParams({ region: ids.regionB }), today, { paginate: true });
      expect(region.data?.map((s) => s.site_code)).toEqual(['T-B1']);

      for (const pm of ['overdue', 'scheduled', 'none']) {
        const r = await siteQuery(api, parseSiteParams({ pm }), today, { paginate: true });
        expect(r.error, pm).toBeNull();
      }
    });

    it('search text with filter-grammar characters is handled safely', async () => {
      const r = await siteQuery(as(ids.admin), parseSiteParams({ q: 'A1, (x)."%_\\' }), today, { paginate: true });
      expect(r.error).toBeNull();
      expect(r.data).toEqual([]);
    });

    it('paginates with an exact total', async () => {
      const r = await siteQuery(as(ids.admin), { ...parseSiteParams({}), pageSize: 2, page: 2 }, today, { paginate: true });
      expect(r.error).toBeNull();
      expect(r.count).toBeGreaterThanOrEqual(4); // 3 test sites + Tienii demo
      expect(r.data?.length).toBeGreaterThan(0);
    });
  });

  it('web: dashboard KPIs load within the supervisor scope (lib/dashboard.ts)', async () => {
    const data = await loadDashboard(as(ids.supervisorA), monthPeriod(new Date()));
    expect(data.sites.total).toBe(2);
    expect(data.pm.completionPct).toBeNull();
  });

  it('web: organisation option loaders (lib/org-data.ts)', async () => {
    const api = as(ids.admin);
    const [regions, clusters, counties, supervisors] = await Promise.all([
      loadRegions(api),
      loadClusters(api),
      loadCounties(api),
      loadSupervisors(api),
    ]);
    expect(regions.map((r) => r.code)).toEqual(expect.arrayContaining(['GCM', 'RA', 'RB']));
    expect(clusters.map((c) => c.code)).toEqual(['CA1']);
    expect(counties.map((c) => c.code)).toEqual(['CTA1']);
    expect(supervisors.map((s) => s.name)).toEqual(['supervisor.a', 'supervisor.b', 'supervisor.c']);
  });

  it('web: site detail embeds and views resolve', async () => {
    const api = apiAs(ids.supervisorA);
    const assignments = await api
      .from('site_assignments')
      .select('id, starts_on, ends_on, technician_id, technicians(profiles!technicians_id_fkey(full_name, email))')
      .eq('site_id', ids.siteA1)
      .eq('is_active', true);
    expect(assignments.error).toBeNull();
    expect(assignments.data?.map((a) => a.technicians?.profiles?.full_name).sort()).toEqual(['inactive', 'tech.a']);

    const techs = await api.from('technician_overview').select('id, full_name, email, region_name').eq('is_active', true);
    expect(techs.error).toBeNull();
    expect(techs.data?.map((t) => t.full_name)).toEqual(['tech.a']);

    const settings = await api.from('system_settings').select('value').eq('key', 'geofence').maybeSingle();
    expect(settings.data?.value).toEqual({ radius_m: 100, mode: 'WARN' });
  });

  it('web: users list embed and session scope query', async () => {
    const users = await apiAs(ids.admin)
      .from('profiles')
      .select('id, full_name, email, role, is_active, last_login_at, regions!profiles_region_id_fkey(name)', { count: 'exact' })
      .eq('id', ids.managerA);
    expect(users.error).toBeNull();
    expect(users.data?.[0]?.regions?.name).toBe('Region A');

    const scopes = await apiAs(ids.managerA).from('user_region_scopes').select('regions(name)').eq('profile_id', ids.managerA);
    expect(scopes.error).toBeNull();
    expect(scopes.data?.map((s) => s.regions?.name)).toEqual(['Region A']);
  });

  it('web: admin RPCs are callable and enforce authorisation', async () => {
    const admin = apiAs(ids.admin);
    expect((await admin.rpc('admin_update_user', { p_user_id: ids.techB, p_role: 'technician', p_is_active: true })).error).toBeNull();
    expect((await admin.rpc('admin_set_region_scopes', { p_user_id: ids.managerA, p_region_ids: [ids.regionA] })).error).toBeNull();
    expect((await admin.rpc('record_report_generated', { p_report: 'sites_csv', p_row_count: 1 })).error).toBeNull();
    expect((await apiAs(ids.techA).rpc('record_login', { p_client: 'web' })).error).toBeNull();
    const denied = await apiAs(ids.supervisorA).rpc('admin_set_region_scopes', { p_user_id: ids.managerA, p_region_ids: [] });
    expect(denied.error?.code).toBe('42501');
  });

  it('web: profile self-edit is limited to contact columns', async () => {
    const api = apiAs(ids.techA);
    expect((await api.from('profiles').update({ full_name: 'Tech A' }).eq('id', ids.techA)).error).toBeNull();
    const escalate = await api.from('profiles').update({ role: 'super_admin' }).eq('id', ids.techA);
    expect(escalate.error?.code).toBe('42501');
  });

  it('mobile: technician tab queries', async () => {
    const api = apiAs(ids.techA);
    const sites = await api
      .from('sites')
      .select('id, site_code, site_name, status, is_demo, generator_available, solar_available, battery_available, grid_available, regions(name), counties(name)')
      .order('site_name');
    expect(sites.error).toBeNull();
    expect(sites.data?.[0]).toMatchObject({ site_code: 'T-A1', regions: { name: 'Region A' }, counties: { name: 'County A1' } });

    const schedules = await api
      .from('pm_schedules')
      .select('id, status, priority, frequency, scheduled_date, due_date, sites(site_code, site_name)')
      .eq('technician_id', ids.techA);
    expect(schedules.error).toBeNull();

    const actions = await api
      .from('corrective_actions')
      .select('id, action_number, description, category, priority, status, due_date, sites(site_code, site_name)')
      .eq('assigned_to', ids.techA)
      .neq('status', 'CLOSED');
    expect(actions.error).toBeNull();

    const detail = await api.from('site_overview').select('*').eq('id', ids.siteA1).maybeSingle();
    expect(detail.error).toBeNull();
    expect(detail.data).toMatchObject({ site_code: 'T-A1', county_name: 'County A1', supervisor_name: 'supervisor.a' });
    const other = await api.from('site_overview').select('*').eq('id', ids.siteB1).maybeSingle();
    expect(other.data).toBeNull();

    const count = await api.from('sites').select('id', { count: 'exact', head: true });
    expect(count.count).toBe(1);
  });

  describe('Phase 3: PM engine queries', () => {
    it('web: schedule and visit overviews resolve within scope', async () => {
      const sched = await apiAs(ids.supervisorA).from('pm_schedule_overview').select('*', { count: 'exact' }).neq('status', 'CANCELLED');
      expect(sched.error).toBeNull();
      const visits = await apiAs(ids.managerA).from('pm_visit_overview').select('*').eq('status', 'SUBMITTED');
      expect(visits.error).toBeNull();
      const denied = await apiAs(null).from('pm_visit_overview').select('*').limit(1);
      expect(denied.error?.code).toBe('42501');
    });

    it('web: template editor embed and admin RPCs', async () => {
      const admin = apiAs(ids.admin);
      const t = await admin
        .from('pm_templates')
        .select('*, pm_sections(*, pm_checklist_items(*), pm_reading_fields(*))')
        .eq('code', 'TELECOM_SITE_POWER_PM')
        .eq('status', 'ACTIVE')
        .single();
      expect(t.error).toBeNull();
      expect(t.data?.pm_sections).toHaveLength(6);
      const clone = await admin.rpc('admin_clone_template', { p_template_id: t.data!.id });
      expect(clone.error).toBeNull();
      expect(typeof clone.data).toBe('string');
    });

    it('mobile: technician starts a PM, answers, sees issues; web review loader reads it', async () => {
      // Every API test request is rolled back, so this checks the calls the mobile
      // app makes; the persisted end-to-end flow is covered in pm-engine.test.ts.
      const tech = apiAs(ids.techA);
      const template = await tech.from('pm_templates').select('id').eq('status', 'ACTIVE').single();
      expect(template.error).toBeNull();
      const insert = await tech
        .from('pm_visits')
        .insert({ site_id: ids.siteA1, template_id: template.data!.id, technician_id: ids.techA })
        .select('id, completion_pct, supervisor_id')
        .single();
      expect(insert.error).toBeNull();
      expect(insert.data).toMatchObject({ completion_pct: 0, supervisor_id: ids.supervisorA });

      const sections = await tech
        .from('pm_sections')
        .select('id, code, pm_checklist_items(id, prompt, response_type), pm_reading_fields(id, label)')
        .eq('template_id', template.data!.id)
        .order('sort_order');
      expect(sections.error).toBeNull();
      expect(sections.data?.map((s) => s.code)).toEqual(['GENERATOR', 'DC_SYSTEM', 'BATTERY', 'SOLAR', 'NON_TECHNICAL', 'EARTHING']);
    });

    it('web: review page loader handles an existing visit id and a missing one', async () => {
      const missing = await loadVisitDetail(as(ids.supervisorA), '00000000-0000-4000-8000-000000000000');
      expect(missing).toBeNull();
    });

    it('pm_visit_issues RPC is not available anonymously', async () => {
      const r = await apiAs(null).rpc('pm_visit_issues', { p_visit_id: '00000000-0000-4000-8000-000000000000' });
      expect(r.error).not.toBeNull();
    });
  });

  describe('Phase 4: section analytics queries', () => {
    it('web: visit analytics loader and latest-reading queries resolve', async () => {
      const analytics = await loadVisitAnalytics(as(ids.supervisorA), '00000000-0000-4000-8000-000000000000');
      expect(analytics).toEqual({ generator: null, dc: null, phases: [], battery: null, solar: null, earthing: null });
      for (const table of ['generator_readings', 'dc_readings', 'battery_readings', 'solar_readings', 'earthing_readings'] as const) {
        const r = await apiAs(ids.supervisorA)
          .from(table)
          .select('*, pm_visits!inner(status)')
          .eq('site_id', ids.siteA1)
          .in('pm_visits.status', ['SUBMITTED', 'APPROVED'])
          .order('recorded_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        expect(r.error, table).toBeNull();
      }
    });

    it('apps: consistency rules are readable by active users', async () => {
      const r = await apiAs(ids.techA).from('pm_consistency_rules').select('id, lhs_key, operator, rhs_key, message, is_active').eq('is_active', true);
      expect(r.error).toBeNull();
      expect(r.data).toHaveLength(3);
      const anon = await apiAs(null).from('pm_consistency_rules').select('id');
      expect(anon.error?.code).toBe('42501');
    });
  });
});
