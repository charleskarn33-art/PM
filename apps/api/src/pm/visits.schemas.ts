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
    /** The phone's position when starting; omitted when the location is unavailable. */
    gps: z
      .strictObject({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        accuracyM: z.number().min(0).max(100_000).optional(),
        capturedAt: at.optional(),
      })
      .optional(),
    /** Why the PM is started outside the site radius (or without a location), when the geofence asks for one. */
    outsideRadiusReason: z
      .string()
      .trim()
      .max(500)
      .optional()
      .transform((v) => v || undefined),
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

export const BatteryUnitsInput = z.strictObject({
  units: z
    .array(
      z.strictObject({
        unitNumber: z.number().int().min(1).max(1000),
        /** null clears the unit's reading. */
        voltageV: number.nullish(),
        comment: z.string().trim().max(500).nullish(),
        clientUpdatedAt: at.optional(),
      }),
    )
    .min(1)
    .max(1000)
    .refine((u) => new Set(u.map((x) => x.unitNumber)).size === u.length, 'each battery once'),
});

/**
 * A signature as the strokes drawn on the phone (points in a width × height
 * box). The server draws the image itself, so no uploaded file is ever served.
 */
export const SignatureInput = z
  .strictObject({
    name: z.string().trim().min(1).max(120).optional(),
    width: z.number().int().min(50).max(2000),
    height: z.number().int().min(50).max(2000),
    strokes: z
      .array(z.array(z.tuple([z.number().finite(), z.number().finite()])).min(1).max(2000))
      .min(1)
      .max(100),
  })
  .superRefine((v, ctx) => {
    const points = v.strokes.reduce((n, s) => n + s.length, 0);
    if (points > 5000) ctx.addIssue({ code: 'custom', path: ['strokes'], message: 'too many points' });
    if (points < 2) ctx.addIssue({ code: 'custom', path: ['strokes'], message: 'the signature is empty' });
    if (v.strokes.some((s) => s.some(([x, y]) => x < 0 || y < 0 || x > v.width || y > v.height))) {
      ctx.addIssue({ code: 'custom', path: ['strokes'], message: 'points must lie inside the drawing area' });
    }
  });
