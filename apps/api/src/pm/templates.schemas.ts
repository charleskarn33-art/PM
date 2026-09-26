import { z } from 'zod';
import { code } from '../organisation/organisation.schemas.js';

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));
const answers = z.array(z.enum(['YES', 'NO', 'NA'])).transform((a) => [...new Set(a)]);
const options = z
  .array(z.string().trim().min(1).max(100))
  .max(50)
  .refine((o) => new Set(o).size === o.length, 'options must be unique');
const analyticsKey = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/, 'use dotted lower-case keys, e.g. dc.load_current_a')
  .max(80)
  .nullish()
  .transform((v) => v ?? null);
const limit = z.number().finite().nullish().transform((v) => v ?? null);

export const TemplateInput = z.strictObject({
  code: code(40).transform((c) => c.toUpperCase()),
  name: text(120),
  description: optionalText(1000),
});
export const TemplatePatch = z.strictObject({ name: text(120).optional(), description: optionalText(1000) });

export const SectionInput = z.strictObject({
  code: code(40).transform((c) => c.toUpperCase()),
  name: text(120),
  category: z.enum(['GENERATOR', 'DC_SYSTEM', 'BATTERY', 'SOLAR', 'NON_TECHNICAL', 'EARTHING', 'OTHER']),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  description: optionalText(1000),
  allowNotApplicable: z.boolean().optional(),
  requiresEquipment: z.enum(['GENERATOR', 'SOLAR', 'GRID']).nullish(),
  isActive: z.boolean().optional(),
});
export const SectionPatch = SectionInput.partial();

/**
 * A checklist item (all fields; a PATCH is merged with the stored item and
 * checked as a whole). Limits and failure rules only where they make sense
 * for the response type.
 */
export const ItemInput = z
  .strictObject({
    code: code(60).transform((c) => c.toLowerCase()),
    prompt: text(500),
    helpText: optionalText(1000),
    responseType: z.enum(['YES_NO_NA', 'NUMBER', 'TEXT', 'SELECT', 'MULTI_SELECT', 'DATE', 'DATETIME', 'PHOTO']).default('YES_NO_NA'),
    options: options.default([]),
    allowNotApplicable: z.boolean().default(true),
    isRequired: z.boolean().default(true),
    unit: optionalText(20),
    minValue: limit,
    maxValue: limit,
    isInteger: z.boolean().default(false),
    failureOnAnswer: z.enum(['YES', 'NO']).nullish().transform((v) => v ?? null),
    failureSeverity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
    requiresPhotoOnFailure: z.boolean().default(false),
    requiresCommentOnFailure: z.boolean().default(false),
    photoOnAnswers: answers.default([]),
    commentOnAnswers: answers.default([]),
    photoInstructions: optionalText(500),
    analyticsKey,
    sortOrder: z.number().int().min(0).max(10_000).default(0),
    isActive: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    const choice = v.responseType === 'SELECT' || v.responseType === 'MULTI_SELECT';
    if (choice && v.options.length < 2) issue('options', 'give at least two options');
    if (!choice && v.options.length) issue('options', 'only choice questions have options');
    if (v.responseType !== 'NUMBER' && (v.minValue != null || v.maxValue != null || v.isInteger)) issue('minValue', 'limits apply to number questions only');
    if (v.minValue != null && v.maxValue != null && v.minValue > v.maxValue) issue('maxValue', 'must not be below the minimum');
    const yesNo = v.responseType === 'YES_NO_NA';
    if (!yesNo && (v.failureOnAnswer || v.requiresPhotoOnFailure || v.requiresCommentOnFailure)) issue('failureOnAnswer', 'failure rules apply to Yes/No/N/A questions');
    if (!v.failureOnAnswer && (v.requiresPhotoOnFailure || v.requiresCommentOnFailure)) issue('failureOnAnswer', 'set the failure answer for failure evidence rules');
    const allowed = yesNo ? ['YES', 'NO', 'NA'] : ['NA'];
    if ([...v.photoOnAnswers, ...v.commentOnAnswers].some((a) => !allowed.includes(a))) issue('photoOnAnswers', `answers for this question type: ${allowed.join(', ')}`);
    if ([...v.photoOnAnswers, ...v.commentOnAnswers].includes('NA') && !v.allowNotApplicable) issue('photoOnAnswers', 'N/A is not allowed for this question');
  });

export const ReadingFieldInput = z
  .strictObject({
    code: code(60).transform((c) => c.toLowerCase()),
    label: text(200),
    valueType: z.enum(['NUMBER', 'TEXT', 'SELECT']).default('NUMBER'),
    unit: optionalText(20),
    isInteger: z.boolean().default(false),
    minValue: limit,
    maxValue: limit,
    options: options.default([]),
    isRequired: z.boolean().default(false),
    helpText: optionalText(1000),
    analyticsKey,
    sortOrder: z.number().int().min(0).max(10_000).default(0),
    isActive: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (v.valueType === 'SELECT' && v.options.length < 2) issue('options', 'give at least two options');
    if (v.valueType !== 'SELECT' && v.options.length) issue('options', 'only choice readings have options');
    if (v.valueType !== 'NUMBER' && (v.minValue != null || v.maxValue != null || v.isInteger)) issue('minValue', 'limits apply to number readings only');
    if (v.minValue != null && v.maxValue != null && v.minValue > v.maxValue) issue('maxValue', 'must not be below the minimum');
  });

const key = z.string().trim().regex(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/, 'use dotted lower-case keys').max(80);
export const ConsistencyRuleInput = z
  .strictObject({ lhsKey: key, operator: z.enum(['<=', '<', '>=', '>', '=']), rhsKey: key, message: text(255) })
  .refine((v) => v.lhsKey !== v.rhsKey, { message: 'compare two different values', path: ['rhsKey'] });
export const ConsistencyRulePatch = z.strictObject({ message: text(255).optional(), isActive: z.boolean().optional() });

export type ItemInput = z.infer<typeof ItemInput>;
export type ReadingFieldInput = z.infer<typeof ReadingFieldInput>;
