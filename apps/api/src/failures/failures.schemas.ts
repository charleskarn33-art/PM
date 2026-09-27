import { z } from 'zod';

const isoDate = z.iso.date();
const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v === undefined ? undefined : v || null));
const severity = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const priority = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const page = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) };

export const FAILURE_STATUSES = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'VERIFIED', 'CLOSED'] as const;
export const ACTION_STATUSES = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED', 'CLOSED'] as const;

export const FailureListQuery = z.strictObject({
  siteId: z.uuid().optional(),
  visitId: z.uuid().optional(),
  /** A status, or `active` for everything not closed. */
  status: z.enum([...FAILURE_STATUSES, 'active']).optional(),
  severity: severity.optional(),
  source: z.enum(['PM_CHECKLIST', 'MANUAL']).optional(),
  /** Title, or the failure number (FL-000012 or 12). */
  q: z.string().trim().max(100).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  ...page,
});

export const ReportFailureInput = z.strictObject({
  /** Client-generated id: retrying the same report returns the same failure. */
  id: z.uuid().optional(),
  siteId: z.uuid(),
  title: text(500),
  description: optionalText(4000),
  severity: severity.default('MEDIUM'),
  category: z.enum(['GENERATOR', 'DC_SYSTEM', 'BATTERY', 'SOLAR', 'NON_TECHNICAL', 'EARTHING', 'OTHER']).optional(),
});

export const FailurePatch = z
  .strictObject({ title: text(500).optional(), description: optionalText(4000), severity: severity.optional() })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'nothing to change');

export const NoteInput = z.strictObject({ note: text(2000) });
export const OptionalNoteInput = z.strictObject({ note: optionalText(2000) });

export const CommentInput = z.strictObject({ body: text(4000), correctiveActionId: z.uuid().optional() });

export const ActionListQuery = z.strictObject({
  status: z.enum([...ACTION_STATUSES, 'active']).optional(),
  /** `me`, or a user id. */
  assignedTo: z.union([z.literal('me'), z.uuid()]).optional(),
  siteId: z.uuid().optional(),
  failureId: z.uuid().optional(),
  /** Not finished and past the due date. */
  overdue: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  ...page,
});

export const ActionInput = z.strictObject({
  id: z.uuid().optional(),
  failureId: z.uuid(),
  title: text(255),
  description: optionalText(4000),
  priority: priority.default('MEDIUM'),
  assignedToId: z.uuid().optional(),
  dueDate: isoDate.optional(),
});

export const ActionPatch = z
  .strictObject({ title: text(255).optional(), description: optionalText(4000), priority: priority.optional(), dueDate: isoDate.nullish() })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'nothing to change');

export const AssignInput = z.strictObject({ assignedToId: z.uuid(), dueDate: isoDate.nullish() });

export const VerifyInput = z
  .strictObject({ decision: z.enum(['APPROVE', 'REJECT']), note: optionalText(2000) })
  .refine((v) => v.decision === 'APPROVE' || v.note, { message: 'say what must be redone', path: ['note'] });

export const AttachmentFields = z.strictObject({
  id: z.uuid().optional(),
  correctiveActionId: z.uuid().optional(),
  caption: z.string().trim().max(255).optional(),
});
