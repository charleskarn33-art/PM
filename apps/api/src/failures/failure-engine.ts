import { randomUUID } from 'node:crypto';
import type { PmVisit, Prisma } from '../generated/prisma/client.js';
import { stringList } from '../pm/mapping.js';

type Tx = Prisma.TransactionClient;

export interface FailureSyncResult {
  created: string[];
  updated: string[];
  removed: string[];
  noLongerReported: string[];
}

const description = (answer: string | null, comment: string | null) => `Answered ${answer ?? '—'}${comment?.trim() ? `: ${comment.trim()}` : ''}`;

/**
 * The failure engine: turns the failed answers of a completed PM into
 * failures. Idempotent — running it again on the same visit changes nothing:
 *
 * - one failure per visit and question (unique index); a new failed answer
 *   creates it;
 * - a failure nobody has acted on yet follows the answer (text, severity);
 * - a failure no longer reported after the PM was corrected is deleted when
 *   nobody has acted on it, otherwise marked "no longer reported" (and marked
 *   reported again if the answer fails again);
 * - sections marked not applicable record no failures.
 */
export async function syncVisitFailures(
  tx: Tx,
  visit: Pick<PmVisit, 'id' | 'siteId' | 'technicianId' | 'notApplicableSections' | 'isDemo'>,
  now = new Date(),
): Promise<FailureSyncResult> {
  const na = new Set(stringList(visit.notApplicableSections));
  const failing = (
    await tx.pmResponse.findMany({
      where: { visitId: visit.id, isFailure: true, item: { isActive: true, section: { isActive: true } } },
      include: { item: { include: { section: { select: { code: true, category: true } } } } },
    })
  ).filter((r) => !na.has(r.item.section.code));
  const existing = await tx.failure.findMany({
    where: { visitId: visit.id, source: 'PM_CHECKLIST' },
    include: { _count: { select: { actions: true, attachments: true, updates: { where: { kind: { not: 'SYSTEM' } } } } } },
  });
  const byItem = new Map(existing.map((f) => [f.checklistItemId, f]));
  const untouched = (f: (typeof existing)[number]) => f.status === 'OPEN' && f.closedAt == null && !f._count.actions && !f._count.attachments && !f._count.updates;
  const note = (failureId: string, body: string) => tx.failureUpdate.create({ data: { failureId, kind: 'SYSTEM', body } });
  const out: FailureSyncResult = { created: [], updated: [], removed: [], noLongerReported: [] };

  for (const r of failing) {
    const text = description(r.answer, r.comment);
    const f = byItem.get(r.checklistItemId);
    if (!f) {
      const id = randomUUID();
      await tx.failure.create({
        data: {
          id,
          source: 'PM_CHECKLIST',
          siteId: visit.siteId,
          visitId: visit.id,
          checklistItemId: r.checklistItemId,
          sectionCode: r.item.section.code,
          category: r.item.section.category,
          severity: r.item.failureSeverity,
          title: r.promptSnapshot,
          description: text,
          reportedById: visit.technicianId,
          detectedAt: now,
          isDemo: visit.isDemo,
        },
      });
      await note(id, 'Recorded from the completed PM.');
      out.created.push(id);
      continue;
    }
    const data: Prisma.FailureUpdateInput = {};
    if (untouched(f)) {
      if (f.description !== text) data.description = text;
      if (f.title !== r.promptSnapshot) data.title = r.promptSnapshot;
      if (f.severity !== r.item.failureSeverity) data.severity = r.item.failureSeverity;
    }
    if (!f.stillReported) data.stillReported = true;
    if (Object.keys(data).length) {
      await tx.failure.update({ where: { id: f.id }, data });
      if (data.stillReported) await note(f.id, 'Reported again when the PM was completed again.');
      out.updated.push(f.id);
    }
  }

  const failingItems = new Set(failing.map((r) => r.checklistItemId));
  for (const f of existing) {
    if (failingItems.has(f.checklistItemId!)) continue;
    if (untouched(f)) {
      await tx.failureUpdate.deleteMany({ where: { failureId: f.id } });
      await tx.failure.delete({ where: { id: f.id } });
      out.removed.push(f.id);
    } else if (f.stillReported) {
      await tx.failure.update({ where: { id: f.id }, data: { stillReported: false } });
      await note(f.id, 'No longer reported: the PM was corrected and completed again.');
      out.noLongerReported.push(f.id);
    }
  }
  return out;
}
