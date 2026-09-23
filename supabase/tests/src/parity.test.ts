/**
 * The mobile/web apps compute PM progress and submission issues locally
 * (@ipt/shared). This checks they agree with the database on real data.
 */
import { visitIssues, visitProgress, type ChecklistState } from '@ipt/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { createVisitAs, getPool, ids, inTx, itemId, type Client } from './db';

afterAll(async () => {
  await getPool().end();
});

async function loadState(c: Client, visitId: string): Promise<ChecklistState> {
  const q = async <T>(sql: string) => (await c.query(sql, [visitId])).rows as T[];
  const visit = (await q<{ template_id: string; not_applicable_sections: string[] }>(
    `select template_id, not_applicable_sections from public.pm_visits where id = $1`,
  ))[0]!;
  const sections = await q<ChecklistState['sections'][number]>(
    `select s.id, s.code, s.name, s.is_active, s.allow_not_applicable, s.sort_order
       from public.pm_sections s join public.pm_visits v on v.template_id = s.template_id where v.id = $1`,
  );
  const sectionIds = sections.map((s) => s.id);
  const items = (await c.query(`select * from public.pm_checklist_items where section_id = any($1)`, [sectionIds])).rows;
  const readingFields = (await c.query(`select * from public.pm_reading_fields where section_id = any($1)`, [sectionIds])).rows;
  const responses = await q<ChecklistState['responses'][number]>(
    `select checklist_item_id, answer, numeric_value::float as numeric_value, text_value, selected_options,
            date_value::text, datetime_value::text, comment from public.pm_responses where visit_id = $1`,
  );
  const readings = await q<ChecklistState['readings'][number]>(
    `select reading_field_id, numeric_value::float as numeric_value, text_value from public.pm_readings where visit_id = $1`,
  );
  const photos = await q<{ checklist_item_id: string; n: number }>(
    `select checklist_item_id, count(*)::int as n from public.pm_photos where visit_id = $1 and checklist_item_id is not null group by 1`,
  );
  const consistencyRules = (await c.query(`select id, lhs_key, operator, rhs_key, message, is_active from public.pm_consistency_rules`)).rows;
  return {
    consistencyRules,
    sections,
    items,
    readingFields,
    responses,
    readings,
    photoCounts: Object.fromEntries(photos.map((p) => [p.checklist_item_id, p.n])),
    notApplicableSections: visit.not_applicable_sections,
  };
}

describe('shared checklist rules match the database', () => {
  it('agrees on completion, failures and issues for a partially completed visit', async () => {
    await inTx(async (c) => {
      const visitId = await createVisitAs(c, ids.techA, ids.siteA1);
      const answers: [string, Record<string, unknown>][] = [
        ['gen_burning_oil', { answer: 'YES', comment: 'Smoke under load' }],
        ['gen_automation_working', { answer: 'NO' }],
        ['gen_radiator', { answer: 'N/A' }],
        ['bat_water_top_up', { answer: 'YES' }],
        ['nt_fire_extinguisher', { answer: 'YES' }],
        ['dc_phase_1_amps', { numeric_value: 14.2 }],
        ['sol_damaged_panel_count', { numeric_value: 1 }],
        ['sol_charge_controller', { answer: 'NO' }],
      ];
      for (const [code, values] of answers) {
        const cols = Object.keys(values);
        await c.query(
          `insert into public.pm_responses (visit_id, checklist_item_id, prompt_snapshot, ${cols.join(', ')})
           values ($1, $2, '', ${cols.map((_, i) => `$${i + 3}`).join(', ')})`,
          [visitId, await itemId(c, code), ...Object.values(values)],
        );
      }
      await c.query(
        `insert into public.pm_readings (visit_id, reading_field_id, label_snapshot, numeric_value)
         select $1, f.id, '', 50 from public.pm_reading_fields f join public.pm_sections s on s.id = f.section_id
          join public.pm_templates t on t.id = s.template_id and t.status = 'ACTIVE' where f.code in ('running_hours', 'fuel_level', 'dc_modules_operational')`,
        [visitId],
      );
      // 50 operational modules vs 4 installed: an INCONSISTENT issue on both sides.
      await c.query(
        `insert into public.pm_readings (visit_id, reading_field_id, label_snapshot, numeric_value)
         select $1, f.id, '', 4 from public.pm_reading_fields f join public.pm_sections s on s.id = f.section_id
          join public.pm_templates t on t.id = s.template_id and t.status = 'ACTIVE' where f.code = 'dc_modules_installed'`,
        [visitId],
      );
      await c.query(
        `insert into public.pm_photos (site_id, visit_id, checklist_item_id, file_path, taken_at) values ($1, $2, $3, $4, now())`,
        [ids.siteA1, visitId, await itemId(c, 'nt_fire_extinguisher'), `${visitId}/fe.jpg`],
      );
      await c.query(`update public.pm_visits set not_applicable_sections = '{SOLAR}' where id = $1`, [visitId]);

      const state = await loadState(c, visitId);
      const db = (
        await c.query(`select completion_pct::float as pct, failure_count from public.pm_visits where id = $1`, [visitId])
      ).rows[0];
      const local = visitProgress(state);
      expect(local.completionPct).toBe(db.pct);
      expect(local.failureCount).toBe(db.failure_count);

      const dbIssues = (await c.query(`select ref_id, issue from public.pm_visit_issues($1)`, [visitId])).rows
        .map((r) => `${r.ref_id}:${r.issue}`)
        .sort();
      const localIssues = visitIssues(state).map((i) => `${i.refId}:${i.issue}`).sort();
      expect(localIssues).toEqual(dbIssues);
      expect(localIssues.length).toBeGreaterThan(0);
      expect(localIssues.some((i) => i.endsWith(':INCONSISTENT'))).toBe(true);
    });
  });
});
