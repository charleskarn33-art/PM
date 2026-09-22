import type { Enums } from '../database.types';
import { checkbox, CODE_PATTERN, optionalNumber, optionalText, text, type FieldErrors, type RawInput, type ValidationResult } from './common';

type YesNoNa = Enums<'yes_no_na'>;
const RESPONSE_TYPES: readonly Enums<'response_type'>[] = [
  'YES_NO_NA',
  'NUMBER',
  'TEXT',
  'SELECT',
  'MULTI_SELECT',
  'PHOTO',
  'DATE',
  'DATETIME',
];
const SEVERITIES: readonly Enums<'severity_level'>[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const ANSWERS: readonly YesNoNa[] = ['YES', 'NO', 'N/A'];

/** One option per line (or comma separated); trimmed, de-duplicated. */
export function parseOptions(raw: string): string[] {
  return [...new Set(raw.split(/[\n,]/).map((s) => s.trim()).filter(Boolean))];
}

function answers(raw: RawInput, prefix: string): YesNoNa[] {
  return ANSWERS.filter((a) => checkbox(raw, `${prefix}_${a === 'N/A' ? 'NA' : a}`));
}

function range(raw: RawInput, errors: FieldErrors<string>) {
  const min = optionalNumber(raw, 'min_value');
  const max = optionalNumber(raw, 'max_value');
  if (min === undefined) errors.min_value = 'Minimum must be a number.';
  if (max === undefined) errors.max_value = 'Maximum must be a number.';
  if (min != null && max != null && min > max) errors.max_value = 'Maximum must be greater than or equal to the minimum.';
  return { min_value: min ?? null, max_value: max ?? null };
}

export interface ChecklistItemInput {
  code: string;
  prompt: string;
  help_text: string | null;
  response_type: Enums<'response_type'>;
  options: string[];
  allow_not_applicable: boolean;
  is_required: boolean;
  unit: string | null;
  min_value: number | null;
  max_value: number | null;
  creates_failure_on_no: boolean;
  creates_failure_on_yes: boolean;
  failure_severity: Enums<'severity_level'>;
  requires_photo_on_failure: boolean;
  requires_comment_on_failure: boolean;
  requires_photo_on_answer: YesNoNa[];
  requires_comment_on_answer: YesNoNa[];
  photo_instructions: string | null;
  is_active: boolean;
}

/**
 * Checklist item configuration from the template editor form.
 * Failure rule field `failure_on`: "" | "NO" | "YES".
 */
export function validateChecklistItem(raw: RawInput): ValidationResult<ChecklistItemInput> {
  const errors: FieldErrors<string> = {};
  const code = text(raw, 'code').toLowerCase();
  const prompt = text(raw, 'prompt');
  const response_type = text(raw, 'response_type') as Enums<'response_type'>;
  const failureOn = text(raw, 'failure_on');
  const severity = (text(raw, 'failure_severity') || 'MEDIUM') as Enums<'severity_level'>;
  const options = parseOptions(raw.options ?? '');
  const { min_value, max_value } = range(raw, errors);

  if (!CODE_PATTERN.test(code)) errors.code = 'Code is required: letters, digits, ".", "-" or "_" (max 32).';
  if (prompt.length < 3 || prompt.length > 300) errors.prompt = 'Question must be 3–300 characters.';
  if (!RESPONSE_TYPES.includes(response_type)) errors.response_type = 'Select a response type.';
  if ((response_type === 'SELECT' || response_type === 'MULTI_SELECT') && options.length < 2) {
    errors.options = 'Enter at least two options (one per line).';
  }
  if (failureOn && !['YES', 'NO'].includes(failureOn)) errors.failure_on = 'Invalid failure rule.';
  if (failureOn && response_type !== 'YES_NO_NA') errors.failure_on = 'Failure rules apply only to YES/NO/N/A questions.';
  if (!SEVERITIES.includes(severity)) errors.failure_severity = 'Invalid severity.';
  if (response_type !== 'NUMBER' && (min_value != null || max_value != null)) {
    errors.min_value = 'Minimum/maximum apply only to numeric questions.';
  }
  const photoOn = answers(raw, 'photo_on');
  const commentOn = answers(raw, 'comment_on');
  if (response_type !== 'YES_NO_NA' && (photoOn.length > 0 || commentOn.length > 0)) {
    errors.photo_on = 'Answer-based evidence rules apply only to YES/NO/N/A questions.';
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      code,
      prompt,
      help_text: optionalText(raw, 'help_text'),
      response_type,
      options: response_type === 'SELECT' || response_type === 'MULTI_SELECT' ? options : [],
      allow_not_applicable: checkbox(raw, 'allow_not_applicable'),
      is_required: checkbox(raw, 'is_required'),
      unit: optionalText(raw, 'unit'),
      min_value,
      max_value,
      creates_failure_on_no: failureOn === 'NO',
      creates_failure_on_yes: failureOn === 'YES',
      failure_severity: severity,
      requires_photo_on_failure: Boolean(failureOn) && checkbox(raw, 'requires_photo_on_failure'),
      requires_comment_on_failure: Boolean(failureOn) && checkbox(raw, 'requires_comment_on_failure'),
      requires_photo_on_answer: photoOn,
      requires_comment_on_answer: commentOn,
      photo_instructions: optionalText(raw, 'photo_instructions'),
      is_active: checkbox(raw, 'is_active'),
    },
  };
}

export interface ReadingFieldInput {
  code: string;
  label: string;
  value_type: 'NUMBER' | 'TEXT' | 'SELECT';
  unit: string | null;
  is_integer: boolean;
  min_value: number | null;
  max_value: number | null;
  options: string[];
  is_required: boolean;
  help_text: string | null;
  is_active: boolean;
}

export function validateReadingField(raw: RawInput): ValidationResult<ReadingFieldInput> {
  const errors: FieldErrors<string> = {};
  const code = text(raw, 'code').toLowerCase();
  const label = text(raw, 'label');
  const value_type = text(raw, 'value_type') as ReadingFieldInput['value_type'];
  const options = parseOptions(raw.options ?? '');
  const { min_value, max_value } = range(raw, errors);
  if (!CODE_PATTERN.test(code)) errors.code = 'Code is required: letters, digits, ".", "-" or "_" (max 32).';
  if (label.length < 2 || label.length > 120) errors.label = 'Label must be 2–120 characters.';
  if (!['NUMBER', 'TEXT', 'SELECT'].includes(value_type)) errors.value_type = 'Select a value type.';
  if (value_type === 'SELECT' && options.length < 2) errors.options = 'Enter at least two options (one per line).';
  if (value_type !== 'NUMBER' && (min_value != null || max_value != null)) {
    errors.min_value = 'Minimum/maximum apply only to numeric readings.';
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      code,
      label,
      value_type,
      unit: optionalText(raw, 'unit'),
      is_integer: value_type === 'NUMBER' && checkbox(raw, 'is_integer'),
      min_value,
      max_value,
      options: value_type === 'SELECT' ? options : [],
      is_required: checkbox(raw, 'is_required'),
      help_text: optionalText(raw, 'help_text'),
      is_active: checkbox(raw, 'is_active'),
    },
  };
}

export interface SectionInput {
  name: string;
  description: string | null;
  allow_not_applicable: boolean;
  is_active: boolean;
}

export function validateSection(raw: RawInput): ValidationResult<SectionInput> {
  const name = text(raw, 'name');
  if (name.length < 2 || name.length > 120) return { ok: false, errors: { name: 'Name must be 2–120 characters.' } };
  return {
    ok: true,
    value: {
      name,
      description: optionalText(raw, 'description'),
      allow_not_applicable: checkbox(raw, 'allow_not_applicable'),
      is_active: checkbox(raw, 'is_active'),
    },
  };
}
