import { afterAll, describe, expect, it } from 'vitest';
import { actAs, activeTemplateId, createVisitAs, getPool, ids, inTx, itemId, relaxRequirements, tryQuery } from './db';

afterAll(async () => {
  await getPool().end();
});

const upsertResponse = `
  insert into public.pm_responses (visit_id, checklist_item_id, answer, is_failure, prompt_snapshot)
  values ($1, $2, $3, false, 'client supplied')
  on conflict (visit_id, checklist_item_id) do update set answer = excluded.answer
  returning is_failure, prompt_snapshot`;

describe('PM visit creation', () => {
  it('technician can start PM only on an assigned site, as themselves', async () => {
    await inTx(async (c) => {
      const templateId = await activeTemplateId(c);
      await actAs(c, ids.techA);
      const sql = `insert into public.pm_visits (site_id, template_id, technician_id) values ($1, $2, $3)`;
      expect((await tryQuery(c, sql, [ids.siteA1, templateId, ids.techA])).error).toBeUndefined();
      expect((await tryQuery(c, sql, [ids.siteB1, templateId, ids.techA])).error?.message).toMatch(
        /row-level security/,
      );
      expect((await tryQuery(c, sql, [ids.siteA1, templateId, ids.techB])).error?.message).toMatch(
        /row-level security/,
      );
    });
  });

  it('client-generated visit ids make repeated sync idempotent', async () => {
    await inTx(async (c) => {
      const templateId = await activeTemplateId(c);
      await actAs(c, ids.techA);
      const id = '60000000-0000-4000-8000-000000000001';
      const sql = `insert into public.pm_visits (id, site_id, template_id, technician_id, overall_comments)
                   values ($1, $2, $3, $4, $5)
                   on conflict (id) do update set overall_comments = excluded.overall_comments`;
      await c.query(sql, [id, ids.siteA1, templateId, ids.techA, 'first sync']);
      await c.query(sql, [id, ids.siteA1, templateId, ids.techA, 'second sync']);
      const { rows } = await c.query(`select overall_comments from public.pm_visits where id = $1`, [id]);
      expect(rows).toEqual([{ overall_comments: 'second sync' }]);
    });
  });

  it('technician cannot create a visit already approved or with review fields', async () => {
    await inTx(async (c) => {
      const templateId = await activeTemplateId(c);
      await actAs(c, ids.techA);
      const res = await tryQuery(
        c,
        `insert into public.pm_visits (site_id, template_id, technician_id, status) values ($1, $2, $3, 'APPROVED')`,
        [ids.siteA1, templateId, ids.techA],
      );
      expect(res.error?.message).toMatch(/must be IN_PROGRESS, COMPLETED or SUBMITTED/);
    });
  });

  it('assigns the site supervisor as reviewer regardless of client input', async () => {
    await inTx(async (c) => {
      const templateId = await activeTemplateId(c);
      await actAs(c, ids.techA);
      const { rows } = await c.query(
        `insert into public.pm_visits (site_id, template_id, technician_id, supervisor_id)
         values ($1, $2, $3, $4) returning supervisor_id`,
        [ids.siteA1, templateId, ids.techA, ids.supervisorB],
      );
      expect(rows[0].supervisor_id).toBe(ids.supervisorA);
    });
  });

  it('other technicians cannot see the visit', async () => {
    await inTx(async (c) => {
      const visitId = await createVisitAs(c, ids.techA, ids.siteA1);
      await actAs(c, ids.techB);
      expect((await c.query(`select id from public.pm_visits where id = $1`, [visitId])).rowCount).toBe(0);
      await actAs(c, ids.supervisorB);
      expect((await c.query(`select id from public.pm_visits where id = $1`, [visitId])).rowCount).toBe(0);
      await actAs(c, ids.managerA);
      expect((await c.query(`select id from public.pm_visits where id = $1`, [visitId])).rowCount).toBe(1);
    });
  });
});

describe('checklist responses', () => {
  it('evaluates failure rules server-side and snapshots the prompt', async () => {
    await inTx(async (c) => {
      const visitId = await createVisitAs(c, ids.techA, ids.siteA1);
      const burningOil = await itemId(c, 'gen_burning_oil');
      const automation = await itemId(c, 'gen_automation_working');

      const yes = await c.query(upsertResponse, [visitId, burningOil, 'YES']);
      expect(yes.rows[0]).toEqual({ is_failure: true, prompt_snapshot: 'Is The Machine burning Oil?' });
      const no = await c.query(upsertResponse, [visitId, burningOil, 'NO']);
      expect(no.rows[0].is_failure).toBe(false);
      const autoNo = await c.query(upsertResponse, [visitId, automation, 'NO']);
      expect(autoNo.rows[0].is_failure).toBe(true);
      const na = await c.query(upsertResponse, [visitId, automation, 'N/A']);
      expect(na.rows[0].is_failure).toBe(false);
    });
  });

  it('keeps the original prompt text when an admin later edits the item', async () => {
    await inTx(async (c) => {
      const visitId = await createVisitAs(c, ids.techA, ids.siteA1);
      const item = await itemId(c, 'gen_radiator');
      await c.query(upsertResponse, [visitId, item, 'YES']);
      await actAs(c, ids.admin);
      await c.query(`update public.pm_checklist_items set prompt = 'Radiator inspected' where id = $1`, [item]);
      await actAs(c, ids.techA);
      const { rows } = await c.query(upsertResponse, [visitId, item, 'NO']);
      expect(rows[0].prompt_snapshot).toBe('Check Radiator');
    });
  });

  it('rejects N/A when the item does not allow it', async () => {
    await inTx(async (c) => {
      const item = await itemId(c, 'gen_radiator');
      await c.query(`update public.pm_checklist_items set allow_not_applicable = false where id = $1`, [item]);
      const visitId = await createVisitAs(c, ids.techA, ids.siteA1);
      const res = await tryQuery(c, upsertResponse, [visitId, item, 'N/A']);
      expect(res.error?.message).toMatch(/N\/A is not allowed/);
    });
  });

  it('rejects checklist items from a different template', async () => {
    await inTx(async (c) => {
      const other = await c.query(
        `with t as (insert into public.pm_templates (code, name) values ('OTHER', 'Other') returning id),
              s as (insert into public.pm_sections (template_id, code, name, category)
                    select id, 'X', 'X', 'GENERATOR' from t returning id)
         insert into public.pm_checklist_items (section_id, code, prompt) select id, 'x', 'X?' from s returning id`,
      );
      const visitId = await createVisitAs(c, ids.techA, ids.siteA1);
      const res = await tryQuery(c, upsertResponse, [visitId, other.rows[0].id, 'YES']);
      expect(res.error?.message).toMatch(/does not belong/);
    });
  });

  it('locks responses after submission and reopens them after rejection', async () => {
    await inTx(async (c) => {
      await relaxRequirements(c);
      const visitId = await createVisitAs(c, ids.techA, ids.siteA1);
      const item = await itemId(c, 'gen_radiator');
      await c.query(upsertResponse, [visitId, item, 'YES']);
      await c.query(`update public.pm_visits set status = 'SUBMITTED' where id = $1`, [visitId]);

      const locked = await tryQuery(c, upsertResponse, [visitId, item, 'NO']);
      expect(locked.error?.message).toMatch(/row-level security/);
      const visitEdit = await tryQuery(c, `update public.pm_visits set overall_comments = 'x' where id = $1`, [
        visitId,
      ]);
      expect(visitEdit.error?.message).toMatch(/locked/);

      await actAs(c, ids.supervisorA);
      await c.query(
        `update public.pm_visits set status = 'REJECTED', review_comments = 'Retake radiator photo' where id = $1`,
        [visitId],
      );
      await actAs(c, ids.techA);
      const reopened = await tryQuery(c, upsertResponse, [visitId, item, 'NO']);
      expect(reopened.error).toBeUndefined();
    });
  });
});

describe('PM review workflow', () => {
  it('technician cannot approve their own PM', async () => {
    await inTx(async (c) => {
      const visitId = await createVisitAs(c, ids.techA, ids.siteA1, 'SUBMITTED');
      const res = await tryQuery(c, `update public.pm_visits set status = 'APPROVED' where id = $1`, [visitId]);
      expect(res.error?.code).toBe('42501');
    });
  });

  it('technician cannot reassign the visit to another site or technician', async () => {
    await inTx(async (c) => {
      const visitId = await createVisitAs(c, ids.techA, ids.siteA1);
      const res = await tryQuery(c, `update public.pm_visits set site_id = $2 where id = $1`, [visitId, ids.siteA2]);
      expect(res.error?.message).toMatch(/cannot change: site_id/);
    });
  });

  it('in-scope supervisor approves a submitted PM; out-of-scope supervisor cannot', async () => {
    await inTx(async (c) => {
      const visitId = await createVisitAs(c, ids.techA, ids.siteA1, 'SUBMITTED');
      const submitted = await c.query(`select submitted_at from public.pm_visits where id = $1`, [visitId]);
      expect(submitted.rows[0].submitted_at).not.toBeNull();

      await actAs(c, ids.supervisorB);
      const outOfScope = await tryQuery(c, `update public.pm_visits set status = 'APPROVED' where id = $1`, [visitId]);
      expect(outOfScope.rowCount).toBe(0);

      await actAs(c, ids.supervisorA);
      await c.query(`update public.pm_visits set status = 'APPROVED' where id = $1`, [visitId]);
      const { rows } = await c.query(`select status, reviewed_by from public.pm_visits where id = $1`, [visitId]);
      expect(rows[0]).toEqual({ status: 'APPROVED', reviewed_by: ids.supervisorA });

      await actAs(c, ids.admin);
      const audit = await c.query(
        `select action from public.audit_logs where entity_id = $1 order by id`,
        [visitId],
      );
      expect(audit.rows.map((r) => r.action)).toEqual(['PM_STARTED', 'PM_SUBMITTED', 'PM_APPROVED']);
    });
  });

  it('rejection requires a reason, and only SUBMITTED visits can be reviewed', async () => {
    await inTx(async (c) => {
      const draft = await createVisitAs(c, ids.techA, ids.siteA1);
      const submitted = await createVisitAs(c, ids.techA, ids.siteA1, 'SUBMITTED');
      await actAs(c, ids.supervisorA);
      const noReason = await tryQuery(c, `update public.pm_visits set status = 'REJECTED' where id = $1`, [submitted]);
      expect(noReason.error?.message).toMatch(/rejection reason is required/);
      const notSubmitted = await tryQuery(c, `update public.pm_visits set status = 'APPROVED' where id = $1`, [draft]);
      expect(notSubmitted.error?.message).toMatch(/Only a SUBMITTED PM/);
    });
  });

  it('supervisor cannot alter technician-captured data such as GPS', async () => {
    await inTx(async (c) => {
      const visitId = await createVisitAs(c, ids.techA, ids.siteA1, 'SUBMITTED');
      await actAs(c, ids.supervisorA);
      const res = await tryQuery(c, `update public.pm_visits set gps_latitude = 6.3 where id = $1`, [visitId]);
      expect(res.error?.message).toMatch(/only change review fields/);
    });
  });
});

describe('failures', () => {
  it('prevents duplicate checklist failures for the same visit and item', async () => {
    await inTx(async (c) => {
      const visitId = await createVisitAs(c, ids.techA, ids.siteA1);
      const item = await itemId(c, 'gen_burning_oil');
      await actAs(c, null);
      const sql = `insert into public.failures (source, site_id, visit_id, checklist_item_id, category, description)
                   values ('PM_CHECKLIST', $1, $2, $3, 'GENERATOR', 'Machine burning oil')`;
      await c.query(sql, [ids.siteA1, visitId, item]);
      const dup = await tryQuery(c, sql, [ids.siteA1, visitId, item]);
      expect(dup.error?.code).toBe('23505');
    });
  });

  it('technician may log manual failures only on assigned sites', async () => {
    await inTx(async (c) => {
      await actAs(c, ids.techA);
      const sql = `insert into public.failures (source, site_id, category, description, technician_id)
                   values ('MANUAL', $1, 'SOLAR', 'Panel cracked', $2)`;
      expect((await tryQuery(c, sql, [ids.siteA1, ids.techA])).error).toBeUndefined();
      expect((await tryQuery(c, sql, [ids.siteB1, ids.techA])).error?.message).toMatch(/row-level security/);
    });
  });
});

describe('corrective action workflow', () => {
  async function createAction(c: Parameters<Parameters<typeof inTx>[0]>[0]): Promise<string> {
    await actAs(c, ids.supervisorA);
    const { rows } = await c.query<{ id: string; status: string; assigned_by: string }>(
      `insert into public.corrective_actions (site_id, category, description, assigned_to, due_date)
       values ($1, 'GENERATOR', 'Replace radiator hose', $2, current_date + 3)
       returning id, status, assigned_by`,
      [ids.siteA1, ids.maintenance],
    );
    expect(rows[0]).toMatchObject({ status: 'ASSIGNED', assigned_by: ids.supervisorA });
    return rows[0]!.id;
  }

  it('assignee progresses work; completion needs a resolution; verification is supervisory', async () => {
    await inTx(async (c) => {
      const id = await createAction(c);
      await actAs(c, ids.maintenance);
      await c.query(`update public.corrective_actions set status = 'IN_PROGRESS' where id = $1`, [id]);

      const noResolution = await tryQuery(c, `update public.corrective_actions set status = 'COMPLETED' where id = $1`, [id]);
      expect(noResolution.error?.message).toMatch(/resolution note is required/);
      await c.query(
        `update public.corrective_actions set status = 'COMPLETED', resolution = 'Hose replaced' where id = $1`,
        [id],
      );
      const verify = await tryQuery(c, `update public.corrective_actions set status = 'VERIFIED' where id = $1`, [id]);
      expect(verify.error?.message).toMatch(/cannot set status to VERIFIED/);
      const reassign = await tryQuery(c, `update public.corrective_actions set assigned_to = $2 where id = $1`, [
        id,
        ids.techA,
      ]);
      expect(reassign.error?.message).toMatch(/only change status and resolution/);

      await actAs(c, ids.supervisorA);
      await c.query(`update public.corrective_actions set status = 'VERIFIED' where id = $1`, [id]);
      await c.query(`update public.corrective_actions set status = 'CLOSED' where id = $1`, [id]);

      const timeline = await c.query(
        `select from_status, to_status from public.corrective_action_updates
          where corrective_action_id = $1 order by created_at, to_status`,
        [id],
      );
      expect(timeline.rows).toEqual([
        { from_status: 'ASSIGNED', to_status: 'IN_PROGRESS' },
        { from_status: 'IN_PROGRESS', to_status: 'COMPLETED' },
        { from_status: 'COMPLETED', to_status: 'VERIFIED' },
        { from_status: 'VERIFIED', to_status: 'CLOSED' },
      ]);
      const final = await c.query(
        `select completed_at is not null as completed, verified_by, closed_at is not null as closed
           from public.corrective_actions where id = $1`,
        [id],
      );
      expect(final.rows[0]).toEqual({ completed: true, verified_by: ids.supervisorA, closed: true });
    });
  });

  it('unrelated users cannot see or update the action', async () => {
    await inTx(async (c) => {
      const id = await createAction(c);
      await actAs(c, ids.techB);
      expect((await c.query(`select id from public.corrective_actions where id = $1`, [id])).rowCount).toBe(0);
      const upd = await tryQuery(c, `update public.corrective_actions set status = 'IN_PROGRESS' where id = $1`, [id]);
      expect(upd.rowCount).toBe(0);
    });
  });
});
