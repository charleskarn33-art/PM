import { afterAll, describe, expect, it } from 'vitest';
import { actAs, activeTemplateId, addPhoto, createVisitAs, getPool, ids, inTx, itemId, tryQuery, type Client } from './db';

afterAll(async () => {
  await getPool().end();
});

// Reference template: 62 required checklist items (the 7 clamp-meter phases are
// optional) + 16 required readings = 78 requirements. Solar holds 12 + 3.
const TOTAL_REQUIRED = 78;
const SOLAR_REQUIRED = 15;

async function visitRow(c: Client, visitId: string) {
  const { rows } = await c.query(
    `select completion_pct::float as pct, failure_count, status from public.pm_visits where id = $1`,
    [visitId],
  );
  return rows[0] as { pct: number; failure_count: number; status: string };
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

/** Answers every requirement with a non-failing value, as the owning technician. */
async function completeChecklist(c: Client, visitId: string) {
  await c.query(
    `insert into public.pm_responses (visit_id, checklist_item_id, prompt_snapshot, answer, numeric_value, comment)
     select $1, i.id, '',
            case when i.response_type = 'YES_NO_NA' then
              (case when i.creates_failure_on_no then 'YES' when i.creates_failure_on_yes then 'NO' else 'YES' end)::public.yes_no_na end,
            case when i.response_type = 'NUMBER' then 0 end,
            case when 'YES' = any (i.requires_comment_on_answer) then 'Recorded on site' end
       from public.pm_checklist_items i
       join public.pm_sections s on s.id = i.section_id
       join public.pm_visits v on v.id = $1 and v.template_id = s.template_id
      where i.is_active and i.is_required`,
    [visitId],
  );
  await c.query(
    `insert into public.pm_readings (visit_id, reading_field_id, label_snapshot, numeric_value, text_value)
     select $1, f.id, '', case when f.value_type = 'NUMBER' then 1 end, case when f.value_type <> 'NUMBER' then 'NCU' end
       from public.pm_reading_fields f
       join public.pm_sections s on s.id = f.section_id
       join public.pm_visits v on v.id = $1 and v.template_id = s.template_id
      where f.is_active and f.is_required`,
    [visitId],
  );
  // Fire extinguisher = YES requires a photo of the expiry date.
  await addPhoto(c, {
    siteId: ids.siteA1,
    visitId,
    itemId: await itemId(c, 'nt_fire_extinguisher'),
    path: `${ids.siteA1}/${visitId}/extinguisher.jpg`,
    ownerId: ids.techA,
  });
}

describe('completion and failure count (server-computed)', () => {
  it('tracks completion across checklist items and readings', async () => {
    await inTx(async (c) => {
      const visitId = await createVisitAs(c, ids.techA, ids.siteA1);
      expect(await visitRow(c, visitId)).toMatchObject({ pct: 0, failure_count: 0 });

      await answer(c, visitId, 'gen_radiator', { answer: 'YES' });
      expect((await visitRow(c, visitId)).pct).toBeCloseTo(Math.round((10000 * 1) / TOTAL_REQUIRED) / 100, 2);

      // Optional items (clamp-meter phases) do not change completion.
      await answer(c, visitId, 'dc_phase_1_amps', { numeric_value: 12.5 });
      expect((await visitRow(c, visitId)).pct).toBeCloseTo(Math.round(10000 / TOTAL_REQUIRED) / 100, 2);
    });
  });

  it('counts failures and excludes sections marked N/A', async () => {
    await inTx(async (c) => {
      const visitId = await createVisitAs(c, ids.techA, ids.siteA1);
      await answer(c, visitId, 'gen_burning_oil', { answer: 'YES' });
      await answer(c, visitId, 'sol_charge_controller', { answer: 'NO' });
      expect((await visitRow(c, visitId)).failure_count).toBe(2);

      await c.query(`update public.pm_visits set not_applicable_sections = '{SOLAR}' where id = $1`, [visitId]);
      const row = await visitRow(c, visitId);
      expect(row.failure_count).toBe(1);
      expect(row.pct).toBeCloseTo(Math.round(10000 / (TOTAL_REQUIRED - SOLAR_REQUIRED)) / 100, 2);
    });
  });

  it('does not let clients write derived columns', async () => {
    await inTx(async (c) => {
      const visitId = await createVisitAs(c, ids.techA, ids.siteA1);
      const res = await tryQuery(c, `update public.pm_visits set completion_pct = 100 where id = $1`, [visitId]);
      expect(res.error?.message).toMatch(/cannot change: completion_pct/);
    });
  });

  it('rejects N/A for sections that do not allow it', async () => {
    await inTx(async (c) => {
      const visitId = await createVisitAs(c, ids.techA, ids.siteA1);
      const res = await tryQuery(c, `update public.pm_visits set not_applicable_sections = '{DC_SYSTEM}' where id = $1`, [visitId]);
      expect(res.error?.message).toMatch(/DC_SYSTEM cannot be marked N\/A/);
    });
  });
});

describe('write-time value validation', () => {
  const reading = async (c: Client, visitId: string, code: string, values: Record<string, unknown>) => {
    const cols = Object.keys(values);
    return tryQuery(
      c,
      `insert into public.pm_readings (visit_id, reading_field_id, label_snapshot, ${cols.join(', ')})
       select $1, f.id, '', ${cols.map((_, i) => `$${i + 3}`).join(', ')}
         from public.pm_reading_fields f join public.pm_sections s on s.id = f.section_id
         join public.pm_templates t on t.id = s.template_id and t.status = 'ACTIVE'
        where f.code = $2`,
      [visitId, code, ...Object.values(values)],
    );
  };

  it('enforces configured ranges, whole numbers and value types', async () => {
    await inTx(async (c) => {
      const visitId = await createVisitAs(c, ids.techA, ids.siteA1);
      expect((await reading(c, visitId, 'fuel_level', { numeric_value: 150 })).error?.message).toMatch(/at most 100/);
      expect((await reading(c, visitId, 'running_hours', { numeric_value: -1 })).error?.message).toMatch(/at least 0/);
      expect((await reading(c, visitId, 'rectifier_module_count', { numeric_value: 2.5 })).error?.message).toMatch(
        /whole number/,
      );
      expect((await reading(c, visitId, 'battery_voltage', { text_value: 'high' })).error?.message).toMatch(/numeric reading/);
      expect((await reading(c, visitId, 'fuel_level', { numeric_value: 62.5 })).error).toBeUndefined();

      const phase = await tryQuery(
        c,
        `insert into public.pm_responses (visit_id, checklist_item_id, prompt_snapshot, numeric_value) values ($1, $2, '', -3)`,
        [visitId, await itemId(c, 'dc_phase_2_amps')],
      );
      expect(phase.error?.message).toMatch(/at least 0/);
      const yesOnNumber = await tryQuery(
        c,
        `insert into public.pm_responses (visit_id, checklist_item_id, prompt_snapshot, answer) values ($1, $2, '', 'YES')`,
        [visitId, await itemId(c, 'dc_phase_2_amps')],
      );
      expect(yesOnNumber.error?.message).toMatch(/does not take a YES\/NO answer/);
    });
  });

  it('enforces select options configured by an administrator', async () => {
    await inTx(async (c) => {
      await c.query(
        `update public.pm_reading_fields set value_type = 'SELECT', options = '["NCU","CSB","TRION"]' where code = 'controller_model'`,
      );
      const visitId = await createVisitAs(c, ids.techA, ids.siteA1);
      expect((await reading(c, visitId, 'controller_model', { text_value: 'OTHER' })).error?.message).toMatch(
        /configured options/,
      );
      expect((await reading(c, visitId, 'controller_model', { text_value: 'CSB' })).error).toBeUndefined();
    });
  });
});

describe('submission rules', () => {
  it('blocks submission and lists what is incomplete', async () => {
    await inTx(async (c) => {
      const visitId = await createVisitAs(c, ids.techA, ids.siteA1);
      const res = await tryQuery(c, `update public.pm_visits set status = 'SUBMITTED' where id = $1`, [visitId]);
      expect(res.error?.message).toBe(`Unable to submit because ${TOTAL_REQUIRED} required fields are incomplete.`);

      const issues = await c.query(`select issue, count(*)::int as n from public.pm_visit_issues($1) group by 1`, [visitId]);
      expect(issues.rows).toEqual([{ issue: 'REQUIRED', n: TOTAL_REQUIRED }]);
    });
  });

  it('cannot bypass the check by creating a visit already SUBMITTED', async () => {
    await inTx(async (c) => {
      const templateId = await activeTemplateId(c);
      await actAs(c, ids.techA);
      const res = await tryQuery(
        c,
        `insert into public.pm_visits (site_id, template_id, technician_id, status) values ($1, $2, $3, 'SUBMITTED')`,
        [ids.siteA1, templateId, ids.techA],
      );
      expect(res.error?.message).toMatch(/Unable to submit because 78 required fields are incomplete/);
    });
  });

  it('requires a comment and photo for failures, then submits when complete', async () => {
    await inTx(async (c) => {
      const visitId = await createVisitAs(c, ids.techA, ids.siteA1);
      await completeChecklist(c, visitId);
      expect((await visitRow(c, visitId)).pct).toBe(100);

      await answer(c, visitId, 'gen_burning_oil', { answer: 'YES' });
      const issues = await c.query(`select issue from public.pm_visit_issues($1) order by issue`, [visitId]);
      expect(issues.rows.map((r) => r.issue)).toEqual(['COMMENT_REQUIRED', 'PHOTO_REQUIRED']);

      await answer(c, visitId, 'gen_burning_oil', { answer: 'YES', comment: 'Blue smoke at load; oil level low.' });
      await addPhoto(c, {
        siteId: ids.siteA1,
        visitId,
        itemId: await itemId(c, 'gen_burning_oil'),
        path: `${ids.siteA1}/${visitId}/oil.jpg`,
        ownerId: ids.techA,
      });
      await c.query(`update public.pm_visits set status = 'SUBMITTED' where id = $1`, [visitId]);
      expect(await visitRow(c, visitId)).toMatchObject({ status: 'SUBMITTED', failure_count: 1, pct: 100 });
    });
  });

  it('requires the configured comment for an answer (battery water top-up = YES)', async () => {
    await inTx(async (c) => {
      const visitId = await createVisitAs(c, ids.techA, ids.siteA1);
      await answer(c, visitId, 'bat_water_top_up', { answer: 'YES' });
      const issues = await c.query(`select label, issue from public.pm_visit_issues($1) where issue <> 'REQUIRED'`, [visitId]);
      expect(issues.rows).toEqual([{ label: 'Does the battery require water top-up?', issue: 'COMMENT_REQUIRED' }]);
    });
  });

  it('photo enforcement can be switched off by an administrator', async () => {
    await inTx(async (c) => {
      const visitId = await createVisitAs(c, ids.techA, ids.siteA1);
      await answer(c, visitId, 'nt_fire_extinguisher', { answer: 'YES' });
      let issues = await c.query(`select issue from public.pm_visit_issues($1) where issue = 'PHOTO_REQUIRED'`, [visitId]);
      expect(issues.rowCount).toBe(1);
      await actAs(c, ids.admin);
      await c.query(`update public.system_settings set value = '{"enforce_photo_requirements": false}' where key = 'pm_submission'`);
      await actAs(c, ids.techA);
      issues = await c.query(`select issue from public.pm_visit_issues($1) where issue = 'PHOTO_REQUIRED'`, [visitId]);
      expect(issues.rowCount).toBe(0);
    });
  });

  it('pm_visit_issues is only available to users who can read the visit', async () => {
    await inTx(async (c) => {
      const visitId = await createVisitAs(c, ids.techA, ids.siteA1);
      await actAs(c, ids.techB);
      const res = await tryQuery(c, `select * from public.pm_visit_issues($1)`, [visitId]);
      expect(res.error?.message).toMatch(/not found/);
    });
  });
});

describe('schedules', () => {
  async function schedule(c: Client, dueOffset = 7, technicianId: string = ids.techA): Promise<string> {
    const templateId = await activeTemplateId(c);
    await actAs(c, ids.supervisorA);
    const { rows } = await c.query(
      `insert into public.pm_schedules (site_id, template_id, technician_id, scheduled_date, due_date)
       values ($1, $2, $3, current_date - 14, current_date + $4::int) returning id`,
      [ids.siteA1, templateId, technicianId, dueOffset],
    );
    return rows[0].id;
  }

  async function startFromSchedule(c: Client, scheduleId: string): Promise<string> {
    const templateId = await activeTemplateId(c);
    await actAs(c, ids.techA);
    const { rows } = await c.query(
      `insert into public.pm_visits (site_id, template_id, technician_id, schedule_id) values ($1, $2, $3, $4) returning id`,
      [ids.siteA1, templateId, ids.techA, scheduleId],
    );
    return rows[0].id;
  }

  const scheduleStatus = async (c: Client, id: string) =>
    (await c.query(`select status from public.pm_schedules where id = $1`, [id])).rows[0].status;

  it('follows the visit lifecycle', async () => {
    await inTx(async (c) => {
      const scheduleId = await schedule(c);
      const visitId = await startFromSchedule(c, scheduleId);
      expect(await scheduleStatus(c, scheduleId)).toBe('IN_PROGRESS');

      await completeChecklist(c, visitId);
      await c.query(`update public.pm_visits set status = 'SUBMITTED' where id = $1`, [visitId]);
      expect(await scheduleStatus(c, scheduleId)).toBe('SUBMITTED');

      await actAs(c, ids.supervisorA);
      await c.query(`update public.pm_visits set status = 'APPROVED' where id = $1`, [visitId]);
      expect(await scheduleStatus(c, scheduleId)).toBe('APPROVED');
    });
  });

  it('allows only one live visit per schedule; cancelling frees it', async () => {
    await inTx(async (c) => {
      const scheduleId = await schedule(c, -2);
      const visitId = await startFromSchedule(c, scheduleId);
      const dup = await tryQuery(
        c,
        `insert into public.pm_visits (site_id, template_id, technician_id, schedule_id) values ($1, $2, $3, $4)`,
        [ids.siteA1, await activeTemplateId(c), ids.techA, scheduleId],
      );
      expect(dup.error?.code).toBe('23505');

      await actAs(c, ids.supervisorA);
      await c.query(`update public.pm_visits set status = 'CANCELLED' where id = $1`, [visitId]);
      // Due date has passed, so the reopened schedule is OVERDUE rather than SCHEDULED.
      expect(await scheduleStatus(c, scheduleId)).toBe('OVERDUE');
      await startFromSchedule(c, scheduleId);
      expect(await scheduleStatus(c, scheduleId)).toBe('IN_PROGRESS');
    });
  });

  it('validates the schedule matches the visit site and technician', async () => {
    await inTx(async (c) => {
      const scheduleId = await schedule(c);
      await actAs(c, ids.admin);
      await c.query(`insert into public.site_assignments (site_id, technician_id) values ($1, $2)`, [ids.siteA2, ids.techA]);
      await actAs(c, ids.techA);
      const res = await tryQuery(
        c,
        `insert into public.pm_visits (site_id, template_id, technician_id, schedule_id) values ($1, $2, $3, $4)`,
        [ids.siteA2, await activeTemplateId(c), ids.techA, scheduleId],
      );
      expect(res.error?.message).toMatch(/different site/);
    });
  });

  it('only schedules technicians assigned to the site', async () => {
    await inTx(async (c) => {
      await actAs(c, ids.admin);
      const res = await tryQuery(
        c,
        `insert into public.pm_schedules (site_id, template_id, technician_id, scheduled_date, due_date)
         values ($1, $2, $3, current_date, current_date + 7)`,
        [ids.siteA2, await activeTemplateId(c), ids.techA],
      );
      expect(res.error?.message).toMatch(/not assigned to this site/);
    });
  });

  it('does not schedule inactive technicians', async () => {
    await inTx(async (c) => {
      await actAs(c, ids.supervisorA);
      const res = await tryQuery(
        c,
        `insert into public.pm_schedules (site_id, template_id, technician_id, scheduled_date, due_date)
         values ($1, $2, $3, current_date, current_date + 7)`,
        [ids.siteA1, await activeTemplateId(c), ids.inactiveTech],
      );
      expect(res.error?.message).toMatch(/not active/);
    });
  });

  it('mark_overdue_schedules flags past-due SCHEDULED rows (admin or cron only)', async () => {
    await inTx(async (c) => {
      const pastDue = await schedule(c, -1);
      const future = await schedule(c, 5);
      await actAs(c, ids.supervisorA);
      expect((await tryQuery(c, `select public.mark_overdue_schedules()`)).error?.code).toBe('42501');
      await actAs(c, ids.admin);
      await c.query(`select public.mark_overdue_schedules()`);
      expect(await scheduleStatus(c, pastDue)).toBe('OVERDUE');
      expect(await scheduleStatus(c, future)).toBe('SCHEDULED');
    });
  });
});

describe('template versioning', () => {
  it('clones a draft, activates it, freezes the old version and moves open schedules', async () => {
    await inTx(async (c) => {
      const v1 = await activeTemplateId(c);
      await actAs(c, ids.supervisorA);
      const sched = await c.query(
        `insert into public.pm_schedules (site_id, template_id, technician_id, scheduled_date, due_date)
         values ($1, $2, $3, current_date, current_date + 7) returning id`,
        [ids.siteA1, v1, ids.techA],
      );
      const inProgress = await createVisitAs(c, ids.techA, ids.siteA1);

      await actAs(c, ids.supervisorA);
      expect((await tryQuery(c, `select public.admin_clone_template($1)`, [v1])).error?.code).toBe('42501');

      await actAs(c, ids.admin);
      const v2 = (await c.query(`select public.admin_clone_template($1) as id`, [v1])).rows[0].id;
      const draft = await c.query(
        `select t.version, t.status, (select count(*)::int from public.pm_checklist_items i join public.pm_sections s on s.id = i.section_id where s.template_id = t.id) as items
           from public.pm_templates t where t.id = $1`,
        [v2],
      );
      expect(draft.rows[0]).toEqual({ version: 2, status: 'DRAFT', items: 69 });

      await actAs(c, ids.techA);
      const draftVisit = await tryQuery(
        c,
        `insert into public.pm_visits (site_id, template_id, technician_id) values ($1, $2, $3)`,
        [ids.siteA1, v2, ids.techA],
      );
      expect(draftVisit.error?.message).toMatch(/draft PM template/);

      await actAs(c, ids.admin);
      await c.query(`select public.admin_activate_template($1)`, [v2]);
      const statuses = await c.query(`select id, status from public.pm_templates where code = 'TELECOM_SITE_POWER_PM' order by version`);
      expect(statuses.rows.map((r) => r.status)).toEqual(['RETIRED', 'ACTIVE']);
      const moved = await c.query(`select template_id from public.pm_schedules where id = $1`, [sched.rows[0].id]);
      expect(moved.rows[0].template_id).toBe(v2);
      const visit = await c.query(`select template_id from public.pm_visits where id = $1`, [inProgress]);
      expect(visit.rows[0].template_id).toBe(v1);

      const frozen = await tryQuery(
        c,
        `update public.pm_checklist_items set prompt = 'x' where section_id in (select id from public.pm_sections where template_id = $1)`,
        [v1],
      );
      expect(frozen.error?.message).toMatch(/Retired template versions cannot be changed/);
    });
  });

  it('records when an item is deactivated', async () => {
    await inTx(async (c) => {
      await actAs(c, ids.admin);
      const { rows } = await c.query(
        `update public.pm_checklist_items set is_active = false where code = 'gen_radiator' returning deactivated_at is not null as stamped`,
      );
      expect(rows[0].stamped).toBe(true);
      const again = await c.query(
        `update public.pm_checklist_items set is_active = true where code = 'gen_radiator' returning deactivated_at`,
      );
      expect(again.rows[0].deactivated_at).toBeNull();
    });
  });
});
