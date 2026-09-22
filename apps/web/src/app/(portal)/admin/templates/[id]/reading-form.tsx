'use client';

import type { Tables } from '@ipt/shared';
import { useActionState, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormSelect } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { saveReading, type TemplateFormState } from '../actions';

type Field = Tables<'pm_reading_fields'>;

export function ReadingForm({ templateId, sectionId, field, readOnly }: { templateId: string; sectionId: string; field?: Field; readOnly: boolean }) {
  const [state, action, pending] = useActionState<TemplateFormState, FormData>(saveReading, {});
  const v = state.values;
  const e = state.fieldErrors ?? {};
  const [type, setType] = useState<string>(v?.value_type ?? field?.value_type ?? 'NUMBER');
  const val = (k: keyof Field & string): string => (v ? (v[k] ?? '') : field?.[k] == null ? '' : String(field[k]));
  const on = (k: string, current: boolean) => (v ? v[k] === 'on' : current);
  const err = (k: string) => (e[k] ? <p className="text-xs text-danger">{e[k]}</p> : null);
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="template_id" value={templateId} />
      <input type="hidden" name="section_id" value={sectionId} />
      {field ? <input type="hidden" name="id" value={field.id} /> : null}
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      <fieldset disabled={readOnly} className="space-y-5">
        <div className="grid gap-4 md:grid-cols-[1fr_200px_200px]">
          <div className="space-y-1.5">
            <Label htmlFor="label">Label</Label>
            <Input id="label" name="label" defaultValue={val('label')} required />
            {err('label')}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="code">Code</Label>
            <Input id="code" name="code" defaultValue={val('code')} required />
            {err('code')}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="value_type">Value type</Label>
            <FormSelect id="value_type" name="value_type" defaultValue={type} onChange={(ev) => setType(ev.target.value)}>
              <option value="NUMBER">Number</option>
              <option value="TEXT">Text</option>
              <option value="SELECT">Single choice</option>
            </FormSelect>
          </div>
        </div>
        {type === 'NUMBER' ? (
          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="unit">Unit</Label>
              <Input id="unit" name="unit" defaultValue={val('unit')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="min_value">Minimum</Label>
              <Input id="min_value" name="min_value" inputMode="decimal" defaultValue={val('min_value')} />
              {err('min_value')}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="max_value">Maximum</Label>
              <Input id="max_value" name="max_value" inputMode="decimal" defaultValue={val('max_value')} />
              {err('max_value')}
            </div>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input type="checkbox" name="is_integer" defaultChecked={on('is_integer', field?.is_integer ?? false)} className="size-4" />
              Whole numbers only
            </label>
          </div>
        ) : null}
        {type === 'SELECT' ? (
          <div className="space-y-1.5">
            <Label htmlFor="options">Options (one per line)</Label>
            <Textarea id="options" name="options" defaultValue={v?.options ?? (field?.options as string[] | undefined)?.join('\n') ?? ''} />
            {err('options')}
          </div>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="help_text">Help text</Label>
          <Input id="help_text" name="help_text" defaultValue={val('help_text')} />
        </div>
        <div className="flex flex-wrap gap-6 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="is_required" defaultChecked={on('is_required', field?.is_required ?? true)} className="size-4" />
            Required
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="is_active" defaultChecked={on('is_active', field?.is_active ?? true)} className="size-4" />
            Active
          </label>
        </div>
      </fieldset>
      {readOnly ? null : (
        <Button type="submit" disabled={pending}>
          {field ? 'Save reading' : 'Add reading'}
        </Button>
      )}
    </form>
  );
}
