import { z } from 'zod';

/** Stored as DECIMAL(18,6): values must fit (a storage bound, not an engineering limit). */
const number = z.number().finite().gt(-1e12).lt(1e12);
const at = z.iso.datetime({ offset: true });

export const StartVisitInput = z
  .strictObject({
    /** Client-generated id (offline phones): retrying the same start returns the same visit. */
    id: z.uuid().optional(),
    scheduleId: z.uuid().optional(),
    /** Unscheduled PM of a site. */
    siteId: z.uuid().optional(),
    templateCode: z.string().trim().max(40).optional(),
    clientCreatedAt: at.optional(),
  })
  .refine((v) => Boolean(v.scheduleId) !== Boolean(v.siteId), { message: 'give either the schedule or the site', path: ['scheduleId'] });

export const ResponseInput = z.strictObject({
  checklistItemId: z.uuid(),
  answer: z.enum(['YES', 'NO', 'NA']).nullish(),
  numericValue: number.nullish(),
  textValue: z.string().max(2000).nullish(),
  selectedOptions: z.array(z.string().max(100)).max(50).nullish(),
  dateValue: z.string().max(10).nullish(),
  datetimeValue: z.string().max(40).nullish(),
  comment: z.string().max(2000).nullish(),
  /** When the phone recorded this answer: an older copy never overwrites a newer one. */
  clientUpdatedAt: at.optional(),
});

export const ReadingInput = z.strictObject({
  readingFieldId: z.uuid(),
  numericValue: number.nullish(),
  textValue: z.string().max(500).nullish(),
  clientUpdatedAt: at.optional(),
});

export const AnswersInput = z.strictObject({
  responses: z.array(ResponseInput).max(500).default([]),
  readings: z.array(ReadingInput).max(200).default([]),
  /** Section codes not applicable at this site (replaces the list). */
  notApplicableSections: z.array(z.string().trim().max(40)).max(50).optional(),
  overallComments: z
    .string()
    .trim()
    .max(4000)
    .nullish()
    .transform((v) => (v === undefined ? undefined : v || null)),
});

export const ReviewInput = z
  .strictObject({
    decision: z.enum(['APPROVE', 'REJECT']),
    comments: z
      .string()
      .trim()
      .max(2000)
      .optional()
      .transform((v) => v || null),
  })
  .refine((v) => v.decision === 'APPROVE' || v.comments, { message: 'say what must be corrected', path: ['comments'] });

const statuses = ['IN_PROGRESS', 'COMPLETED', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export const VisitListQuery = z.strictObject({
  siteId: z.uuid().optional(),
  technicianId: z.uuid().optional(),
  status: z.enum(statuses).optional(),
  mine: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const PhotoFields = z.strictObject({
  id: z.uuid().optional(),
  checklistItemId: z.uuid().optional(),
  caption: z.string().trim().max(255).optional(),
  takenAt: at.optional(),
});
