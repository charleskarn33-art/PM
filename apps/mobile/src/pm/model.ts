/**
 * Mobile PM model helpers (pure, unit-tested). Rules about completeness and
 * failures come from @ipt/shared so the phone agrees with the server.
 */
import type { ChecklistItem, ReadingField, ResponseValue, Tables } from '@ipt/shared';

export type Item = Tables<'pm_checklist_items'>;
export type Field = Tables<'pm_reading_fields'>;
export type ResponseRow = ResponseValue & { comment: string | null };
export type ReadingRow = Pick<Tables<'pm_readings'>, 'reading_field_id' | 'numeric_value' | 'text_value'>;

export const EMPTY_RESPONSE = (itemId: string): ResponseRow => ({
  checklist_item_id: itemId,
  answer: null,
  numeric_value: null,
  text_value: null,
  selected_options: null,
  date_value: null,
  datetime_value: null,
  comment: null,
});

/** Row sent to PostgREST (server fills snapshots, failure flag, audit columns). */
export function responseUpsert(visitId: string, r: ResponseRow, now: string) {
  return {
    visit_id: visitId,
    checklist_item_id: r.checklist_item_id,
    answer: r.answer,
    numeric_value: r.numeric_value,
    text_value: r.text_value,
    selected_options: r.selected_options,
    date_value: r.date_value,
    datetime_value: r.datetime_value,
    comment: r.comment,
    prompt_snapshot: '',
    client_updated_at: now,
  };
}

export function readingUpsert(visitId: string, r: ReadingRow, now: string) {
  return {
    visit_id: visitId,
    reading_field_id: r.reading_field_id,
    numeric_value: r.numeric_value,
    text_value: r.text_value,
    label_snapshot: '',
    client_updated_at: now,
  };
}

/**
 * Parses what a technician typed into a number field. Accepts a comma as the
 * decimal separator (common on phone keypads). Empty -> null (cleared).
 */
export function parseNumberInput(text: string): { value: number | null; error?: string } {
  const t = text.trim().replace(',', '.');
  if (t === '') return { value: null };
  if (!/^-?\d+(\.\d+)?$/.test(t)) return { value: null, error: 'Enter a number' };
  return { value: Number(t) };
}

/** "████████░░ 80%" style progress text for accessibility labels and headers. */
export function progressBarText(pct: number, width = 10): string {
  const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)} ${Math.round(pct)}%`;
}

export function toChecklistItem(i: Item): ChecklistItem {
  return i;
}
export function toReadingField(f: Field): ReadingField {
  return f;
}

export function unitSuffix(unit: string | null | undefined): string {
  return unit ? ` ${unit}` : '';
}

/** Numeric value entered for a keyed reading or item in this visit (null if blank). */
export function keyedValue(
  key: string,
  fields: readonly Field[],
  items: readonly Item[],
  readings: ReadonlyMap<string, ReadingRow>,
  responses: ReadonlyMap<string, ResponseRow>,
): number | null {
  const f = fields.find((x) => x.analytics_key === key);
  if (f) return readings.get(f.id)?.numeric_value ?? null;
  const i = items.find((x) => x.analytics_key === key);
  return i ? (responses.get(i.id)?.numeric_value ?? null) : null;
}

/** Phase-current values entered in this visit, by phase number. */
export function phaseCurrents(items: readonly Item[], responses: ReadonlyMap<string, ResponseRow>): { phase: number; amps: number }[] {
  return items
    .filter((i) => i.analytics_key === 'dc.phase_current')
    .flatMap((i) => {
      const amps = responses.get(i.id)?.numeric_value;
      const phase = Number((i.metadata as { phase_number?: number }).phase_number);
      return amps == null || !Number.isFinite(phase) ? [] : [{ phase, amps }];
    })
    .sort((a, b) => a.phase - b.phase);
}
