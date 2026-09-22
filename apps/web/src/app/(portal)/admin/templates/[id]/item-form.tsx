'use client';

import type { Tables } from '@ipt/shared';
import { useActionState, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormSelect } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { saveItem, type TemplateFormState } from '../actions';

const RESPONSE_TYPES = [
  ['YES_NO_NA', 'YES / NO / N/A'],
  ['NUMBER', 'Number'],
  ['TEXT', 'Text'],
  ['SELECT', 'Single choice'],
  ['MULTI_SELECT', 'Multiple choice'],
  ['PHOTO', 'Photo'],
  ['DATE', 'Date'],
  ['DATETIME', 'Date & time'],
] as const;
const ANSWERS = [
  ['YES', 'YES'],
  ['NO', 'NO'],
  ['NA', 'N/A'],
] as const;

type Item = Tables<'pm_checklist_items'>;

export function ItemForm({ templateId, sectionId, item, readOnly }: { templateId: string; sectionId: string; item?: Item; readOnly: boolean }) {
  const [state, action, pending] = useActionState<TemplateFormState, FormData>(saveItem, {});
  const v = state.values;
  const e = state.fieldErrors ?? {};
  const [type, setType] = useState<string>(v?.response_type ?? item?.response_type ?? 'YES_NO_NA');
  const initialFailure = item?.creates_failure_on_yes ? 'YES' : item?.creates_failure_on_no ? 'NO' : '';
  const [failureOn, setFailureOn] = useState<string>(v?.failure_on ?? initialFailure);
  const val = (k: keyof Item & string, fallback = ''): string =>
    v ? (v[k] ?? '') : item?.[k] == null ? fallback : String(item[k]);
  const on = (k: string, current: boolean) => (v ? v[k] === 'on' : current);
  const answerOn = (list: 'photo_on' | 'comment_on', a: string) =>
    on(`${list}_${a}`, (list === 'photo_on' ? item?.requires_photo_on_answer : item?.requires_comment_on_answer)?.includes(a === 'NA' ? 'N/A' : (a as 'YES' | 'NO')) ?? false);
  const err = (k: string) => (e[k] ? <p className="text-xs text-danger">{e[k]}</p> : null);

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="template_id" value={templateId} />
      <input type="hidden" name="section_id" value={sectionId} />
      {item ? <input type="hidden" name="id" value={item.id} /> : null}
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      <fieldset disabled={readOnly} className="space-y-5">
        <div className="grid gap-4 md:grid-cols-[1fr_200px]">
          <div className="space-y-1.5">
            <Label htmlFor="prompt">Question</Label>
            <Input id="prompt" name="prompt" defaultValue={val('prompt')} required />
            {err('prompt')}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="code">Code</Label>
            <Input id="code" name="code" defaultValue={val('code')} required />
            {err('code')}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="help_text">Help text for the technician</Label>
          <Input id="help_text" name="help_text" defaultValue={val('help_text')} />
        </div>
        <div className="grid gap-4 md:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="response_type">Response type</Label>
            <FormSelect id="response_type" name="response_type" defaultValue={type} onChange={(ev) => setType(ev.target.value)}>
              {RESPONSE_TYPES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </FormSelect>
            {err('response_type')}
          </div>
          {type === 'NUMBER' ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="unit">Unit</Label>
                <Input id="unit" name="unit" defaultValue={val('unit')} placeholder="e.g. A, V, %" />
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
            </>
          ) : null}
        </div>
        {type === 'SELECT' || type === 'MULTI_SELECT' ? (
          <div className="space-y-1.5">
            <Label htmlFor="options">Options (one per line)</Label>
            <Textarea id="options" name="options" defaultValue={v?.options ?? (item?.options as string[] | undefined)?.join('\n') ?? ''} />
            {err('options')}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-6 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="is_required" defaultChecked={on('is_required', item?.is_required ?? true)} className="size-4" />
            Required
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="allow_not_applicable" defaultChecked={on('allow_not_applicable', item?.allow_not_applicable ?? true)} className="size-4" />
            N/A allowed
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="is_active" defaultChecked={on('is_active', item?.is_active ?? true)} className="size-4" />
            Active (deactivate instead of deleting)
          </label>
        </div>

        {type === 'YES_NO_NA' ? (
          <fieldset className="grid gap-4 rounded-lg border p-4 md:grid-cols-3">
            <legend className="px-1 text-sm font-medium">Failure rule</legend>
            <div className="space-y-1.5">
              <Label htmlFor="failure_on">Creates a failure when the answer is</Label>
              <FormSelect id="failure_on" name="failure_on" defaultValue={failureOn} onChange={(ev) => setFailureOn(ev.target.value)}>
                <option value="">Never</option>
                <option value="NO">NO</option>
                <option value="YES">YES</option>
              </FormSelect>
              {err('failure_on')}
            </div>
            {failureOn ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="failure_severity">Severity</Label>
                  <FormSelect id="failure_severity" name="failure_severity" defaultValue={val('failure_severity', 'MEDIUM')}>
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HIGH">High</option>
                    <option value="CRITICAL">Critical</option>
                  </FormSelect>
                </div>
                <div className="space-y-2 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="requires_comment_on_failure" defaultChecked={on('requires_comment_on_failure', item?.requires_comment_on_failure ?? true)} className="size-4" />
                    Comment required on failure
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="requires_photo_on_failure" defaultChecked={on('requires_photo_on_failure', item?.requires_photo_on_failure ?? true)} className="size-4" />
                    Photo required on failure
                  </label>
                </div>
              </>
            ) : null}
          </fieldset>
        ) : null}

        {type === 'YES_NO_NA' ? (
          <fieldset className="space-y-3 rounded-lg border p-4">
            <legend className="px-1 text-sm font-medium">Evidence by answer</legend>
            {(['photo_on', 'comment_on'] as const).map((list) => (
              <div key={list} className="flex flex-wrap items-center gap-4 text-sm">
                <span className="w-44 text-muted-foreground">{list === 'photo_on' ? 'Photo required when' : 'Comment required when'}</span>
                {ANSWERS.map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2">
                    <input type="checkbox" name={`${list}_${key}`} defaultChecked={answerOn(list, key)} className="size-4" />
                    {label}
                  </label>
                ))}
              </div>
            ))}
            {err('photo_on')}
            <div className="space-y-1.5">
              <Label htmlFor="photo_instructions">Photo instructions</Label>
              <Input id="photo_instructions" name="photo_instructions" defaultValue={val('photo_instructions')} placeholder="e.g. Photo must clearly show the expiry date." />
            </div>
          </fieldset>
        ) : null}
      </fieldset>
      {readOnly ? null : (
        <Button type="submit" disabled={pending}>
          {item ? 'Save question' : 'Add question'}
        </Button>
      )}
    </form>
  );
}
