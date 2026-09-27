import { expect } from 'vitest';
import type { signIn } from './http.js';

type As = Awaited<ReturnType<typeof signIn>>;

export const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);

interface Item {
  id: string;
  code: string;
  responseType: string;
  isRequired: boolean;
  minValue: number | null;
  failureOnAnswer: 'YES' | 'NO' | null;
  requiresPhotoOnFailure: boolean;
  requiresCommentOnFailure: boolean;
  photoOnAnswers: string[];
  commentOnAnswers: string[];
}
interface Visit {
  id: string;
  notApplicableSections: string[];
  sections: { code: string; items: Item[]; readingFields: { id: string; valueType: string }[] }[];
}

/**
 * Completes a PM as `tech`: every required answer given; the questions in
 * `failing` get their failure answer (with the comment and photo the
 * template asks for), the others their passing answer. Starts the visit
 * (at `siteId` or for `scheduleId`) unless `visitId` continues one.
 */
export async function completePm(tech: As, opts: { siteId?: string; scheduleId?: string; visitId?: string; failing?: string[] }): Promise<string> {
  const failing = opts.failing ?? [];
  const v: Visit = opts.visitId
    ? (await tech.get(`/visits/${opts.visitId}`).expect(200)).body.data
    : (await tech.post('/visits', opts.scheduleId ? { scheduleId: opts.scheduleId } : { siteId: opts.siteId }).expect(201)).body.data;
  const responses: Record<string, unknown>[] = [];
  const readings: Record<string, unknown>[] = [];
  const photos: string[] = [];
  for (const s of v.sections) {
    if (v.notApplicableSections.includes(s.code)) continue;
    for (const i of s.items) {
      if (i.responseType === 'YES_NO_NA') {
        const fail = failing.includes(i.code);
        const answer = fail ? i.failureOnAnswer! : i.failureOnAnswer === 'YES' ? 'NO' : 'YES';
        const comment = (fail && i.requiresCommentOnFailure) || i.commentOnAnswers.includes(answer);
        responses.push({ checklistItemId: i.id, answer, comment: comment ? `Found on site: ${i.code}` : null });
        if (((fail && i.requiresPhotoOnFailure) || i.photoOnAnswers.includes(answer)) && !opts.visitId) photos.push(i.id);
      } else if (i.responseType === 'NUMBER' && i.isRequired) {
        responses.push({ checklistItemId: i.id, numericValue: i.minValue ?? 0 });
      }
    }
    for (const f of s.readingFields) readings.push(f.valueType === 'NUMBER' ? { readingFieldId: f.id, numericValue: 3 } : { readingFieldId: f.id, textValue: 'Okay' });
  }
  const saved = await tech.put(`/visits/${v.id}/answers`, { responses, readings });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  for (const itemId of photos) await tech.upload(`/visits/${v.id}/photos`, JPEG, 'p.jpg', { checklistItemId: itemId }).expect(201);
  await tech.put(`/visits/${v.id}/signature`, { width: 300, height: 100, strokes: [[[10, 50], [80, 20]]] }).expect(200);
  const done = await tech.post(`/visits/${v.id}/complete`);
  expect(done.status, JSON.stringify(done.body)).toBe(200);
  return v.id;
}
