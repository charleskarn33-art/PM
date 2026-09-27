'use client';

import { humanizeStatus } from '@ipt/shared';
import { useActionState, useState } from 'react';
import { FieldError, FormMessages } from '@/components/form-bits';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormSelect } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { FormState } from '@/lib/form-action';
import { createTemplate, saveItem, saveReadingField, saveRule, saveSection, templateStep } from './actions';

const CATEGORIES = ['GENERATOR', 'DC_SYSTEM', 'BATTERY', 'SOLAR', 'NON_TECHNICAL', 'EARTHING', 'OTHER'];
const RESPONSE_TYPES = ['YES_NO_NA', 'NUMBER', 'TEXT', 'SELECT', 'MULTI_SELECT', 'DATE', 'DATETIME', 'PHOTO'];
const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

function Check({ name, label, defaultChecked }: { name: string; label: string; defaultChecked: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="size-4" />
      {label}
    </label>
  );
}

export function NewTemplateForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(createTemplate, {});
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="grid gap-3 md:grid-cols-[12rem_1fr_auto] md:items-end">
      <div className="md:col-span-3">
        <FormMessages state={state} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="t-code">Code</Label>
        <Input id="t-code" name="code" required maxLength={40} defaultValue={state.values?.code} placeholder="e.g. SOLAR_ONLY_PM" />
        <FieldError message={e.code} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="t-name">Name</Label>
        <Input id="t-name" name="name" required maxLength={120} defaultValue={state.values?.name} />
        <FieldError message={e.name} />
      </div>
      <Button type="submit" disabled={pending}>
        Create draft
      </Button>
    </form>
  );
}

export function TemplateStepButton({ id, step, label, variant = 'outline', confirm }: { id: string; step: 'new-version' | 'activate' | 'delete'; label: string; variant?: 'outline' | 'default' | 'destructive'; confirm?: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(templateStep, {});
  return (
    <form action={action} onSubmit={(ev) => (confirm && !window.confirm(confirm) ? ev.preventDefault() : undefined)} className="inline-flex flex-col gap-1">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="step" value={step} />
      <Button type="submit" size="sm" variant={variant} disabled={pending}>
        {label}
      </Button>
      {state.error ? <span className="max-w-xs text-xs text-danger">{state.error}</span> : null}
      {state.success ? <span className="max-w-xs text-xs text-success">{state.success}</span> : null}
    </form>
  );
}

export function TemplateDetailsForm({ id, name, description }: { id: string; name: string; description: string | null }) {
  const [state, action, pending] = useActionState<FormState, FormData>(templateStep, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="step" value="save" />
      <FormMessages state={state} />
      <div className="space-y-1.5">
        <Label htmlFor="td-name">Name</Label>
        <Input id="td-name" name="name" required maxLength={120} defaultValue={state.values?.name ?? name} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="td-description">Description</Label>
        <Textarea id="td-description" name="description" maxLength={1000} defaultValue={state.values?.description ?? description ?? ''} />
      </div>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        Save
      </Button>
    </form>
  );
}

export interface SectionValues {
  id: string;
  code: string;
  name: string;
  category: string;
  sortOrder: number;
  description: string | null;
  allowNotApplicable: boolean;
  requiresEquipment: string | null;
  isActive: boolean;
}

export function SectionForm({ templateId, section }: { templateId: string; section?: SectionValues }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveSection, {});
  const e = state.fieldErrors ?? {};
  const v = (k: keyof SectionValues, d: unknown = '') => state.values?.[k] ?? (section?.[k] == null ? String(d) : String(section[k]));
  const key = section?.id ?? 'new';
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="templateId" value={templateId} />
      {section ? <input type="hidden" name="id" value={section.id} /> : null}
      <FormMessages state={state} />
      <div className="grid gap-3 md:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor={`${key}-code`}>Code</Label>
          <Input id={`${key}-code`} name="code" required maxLength={40} defaultValue={v('code')} />
          <FieldError message={e.code} />
        </div>
        <div className="space-y-1 md:col-span-2">
          <Label htmlFor={`${key}-name`}>Name</Label>
          <Input id={`${key}-name`} name="name" required maxLength={120} defaultValue={v('name')} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${key}-sort`}>Order</Label>
          <Input id={`${key}-sort`} name="sortOrder" type="number" min={0} max={10000} defaultValue={v('sortOrder', 0)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${key}-category`}>Category</Label>
          <FormSelect id={`${key}-category`} name="category" defaultValue={v('category', 'OTHER')}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {humanizeStatus(c)}
              </option>
            ))}
          </FormSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${key}-equipment`}>N/A without</Label>
          <FormSelect id={`${key}-equipment`} name="requiresEquipment" defaultValue={v('requiresEquipment')}>
            <option value="">—</option>
            <option value="GENERATOR">Generator</option>
            <option value="SOLAR">Solar</option>
            <option value="GRID">Grid</option>
          </FormSelect>
        </div>
        <div className="space-y-1 md:col-span-2">
          <Label htmlFor={`${key}-description`}>Description</Label>
          <Input id={`${key}-description`} name="description" maxLength={1000} defaultValue={v('description')} />
        </div>
      </div>
      <div className="flex flex-wrap gap-4">
        <Check name="allowNotApplicable" label="Can be marked not applicable" defaultChecked={section?.allowNotApplicable ?? true} />
        {section ? <Check name="isActive" label="Active" defaultChecked={section.isActive} /> : null}
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {section ? 'Save section' : 'Add section'}
        </Button>
        {section ? (
          <Button type="submit" size="sm" name="op" value="delete" variant="destructive" disabled={pending}>
            Remove section
          </Button>
        ) : null}
      </div>
    </form>
  );
}

export interface ItemValues {
  id?: string;
  code: string;
  prompt: string;
  helpText: string | null;
  responseType: string;
  options: string[];
  allowNotApplicable: boolean;
  isRequired: boolean;
  unit: string | null;
  minValue: number | null;
  maxValue: number | null;
  isInteger: boolean;
  failureOnAnswer: string | null;
  failureSeverity: string;
  requiresPhotoOnFailure: boolean;
  requiresCommentOnFailure: boolean;
  photoOnAnswers: string[];
  commentOnAnswers: string[];
  photoInstructions: string | null;
  analyticsKey: string | null;
  sortOrder: number;
  isActive: boolean;
}

export function ItemForm({ templateId, sectionId, item, editable }: { templateId: string; sectionId: string; item?: ItemValues; editable: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveItem, {});
  const [type, setType] = useState(item?.responseType ?? 'YES_NO_NA');
  const e = state.fieldErrors ?? {};
  const v = (k: keyof ItemValues, d = '') => state.values?.[k] ?? (item?.[k] == null ? d : Array.isArray(item[k]) ? (item[k] as string[]).join('\n') : String(item[k]));
  const yesNo = type === 'YES_NO_NA';
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="templateId" value={templateId} />
      <input type="hidden" name="sectionId" value={sectionId} />
      {item?.id ? <input type="hidden" name="id" value={item.id} /> : null}
      <FormMessages state={state} />
      <fieldset disabled={!editable} className="space-y-4">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor="i-code">Code</Label>
            <Input id="i-code" name="code" required maxLength={60} defaultValue={v('code')} />
            <FieldError message={e.code} />
          </div>
          <div className="space-y-1 md:col-span-3">
            <Label htmlFor="i-prompt">Question</Label>
            <Input id="i-prompt" name="prompt" required maxLength={500} defaultValue={v('prompt')} />
            <FieldError message={e.prompt} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="i-type">Answer type</Label>
            <FormSelect id="i-type" name="responseType" defaultValue={type} onChange={(ev) => setType(ev.target.value)}>
              {RESPONSE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t === 'YES_NO_NA' ? 'Yes / No / N/A' : humanizeStatus(t)}
                </option>
              ))}
            </FormSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="i-sort">Order</Label>
            <Input id="i-sort" name="sortOrder" type="number" min={0} max={10000} defaultValue={v('sortOrder', '0')} />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label htmlFor="i-key">Analytics key</Label>
            <Input id="i-key" name="analyticsKey" maxLength={80} placeholder="e.g. dc.load_current_a" defaultValue={v('analyticsKey')} />
            <FieldError message={e.analyticsKey} />
          </div>
          <div className="space-y-1 md:col-span-4">
            <Label htmlFor="i-help">Help text</Label>
            <Input id="i-help" name="helpText" maxLength={1000} defaultValue={v('helpText')} />
          </div>
        </div>
        {type === 'SELECT' || type === 'MULTI_SELECT' ? (
          <div className="space-y-1">
            <Label htmlFor="i-options">Options (one per line)</Label>
            <Textarea id="i-options" name="options" defaultValue={v('options')} />
            <FieldError message={e.options} />
          </div>
        ) : null}
        {type === 'NUMBER' ? (
          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1">
              <Label htmlFor="i-unit">Unit</Label>
              <Input id="i-unit" name="unit" maxLength={20} defaultValue={v('unit')} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="i-min">Minimum</Label>
              <Input id="i-min" name="minValue" type="number" step="any" defaultValue={v('minValue')} />
              <FieldError message={e.minValue} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="i-max">Maximum</Label>
              <Input id="i-max" name="maxValue" type="number" step="any" defaultValue={v('maxValue')} />
              <FieldError message={e.maxValue} />
            </div>
            <div className="flex items-end pb-2">
              <Check name="isInteger" label="Whole number" defaultChecked={item?.isInteger ?? false} />
            </div>
            <p className="text-xs text-muted-foreground md:col-span-4">Leave limits empty unless they are defined for this measurement; none are assumed.</p>
          </div>
        ) : null}
        {yesNo ? (
          <div className="grid gap-3 rounded-lg border p-3 md:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="i-failure">Failure when the answer is</Label>
              <FormSelect id="i-failure" name="failureOnAnswer" defaultValue={v('failureOnAnswer')}>
                <option value="">Never</option>
                <option value="YES">Yes</option>
                <option value="NO">No</option>
              </FormSelect>
              <FieldError message={e.failureOnAnswer} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="i-severity">Failure severity</Label>
              <FormSelect id="i-severity" name="failureSeverity" defaultValue={v('failureSeverity', 'MEDIUM')}>
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {humanizeStatus(s)}
                  </option>
                ))}
              </FormSelect>
            </div>
            <div className="space-y-2 pt-5">
              <Check name="requiresCommentOnFailure" label="Comment required on failure" defaultChecked={item?.requiresCommentOnFailure ?? false} />
              <Check name="requiresPhotoOnFailure" label="Photo required on failure" defaultChecked={item?.requiresPhotoOnFailure ?? false} />
            </div>
          </div>
        ) : (
          <input type="hidden" name="failureSeverity" value="MEDIUM" />
        )}
        <div className="grid gap-3 md:grid-cols-2">
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">Photo needed when the answer is</legend>
            <div className="flex gap-4">
              {(yesNo ? ['YES', 'NO', 'NA'] : ['NA']).map((a) => (
                <label key={a} className="flex items-center gap-1 text-sm">
                  <input type="checkbox" name="photoOnAnswers" value={a} defaultChecked={item?.photoOnAnswers.includes(a)} />
                  {a === 'NA' ? 'N/A' : humanizeStatus(a)}
                </label>
              ))}
            </div>
            <FieldError message={e.photoOnAnswers} />
          </fieldset>
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">Comment needed when the answer is</legend>
            <div className="flex gap-4">
              {(yesNo ? ['YES', 'NO', 'NA'] : ['NA']).map((a) => (
                <label key={a} className="flex items-center gap-1 text-sm">
                  <input type="checkbox" name="commentOnAnswers" value={a} defaultChecked={item?.commentOnAnswers.includes(a)} />
                  {a === 'NA' ? 'N/A' : humanizeStatus(a)}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="space-y-1 md:col-span-2">
            <Label htmlFor="i-photo">Photo instructions</Label>
            <Input id="i-photo" name="photoInstructions" maxLength={500} defaultValue={v('photoInstructions')} />
          </div>
        </div>
        <div className="flex flex-wrap gap-4">
          <Check name="isRequired" label="Required" defaultChecked={item?.isRequired ?? true} />
          <Check name="allowNotApplicable" label="N/A allowed" defaultChecked={item?.allowNotApplicable ?? true} />
          <Check name="isActive" label="Active" defaultChecked={item?.isActive ?? true} />
        </div>
      </fieldset>
      {editable ? (
        <div className="flex gap-2">
          <Button type="submit" disabled={pending}>
            {item?.id ? 'Save question' : 'Add question'}
          </Button>
          {item?.id ? (
            <Button type="submit" name="op" value="delete" variant="destructive" disabled={pending}>
              Remove question
            </Button>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}

export interface ReadingValues {
  id?: string;
  code: string;
  label: string;
  valueType: string;
  unit: string | null;
  isInteger: boolean;
  minValue: number | null;
  maxValue: number | null;
  options: string[];
  isRequired: boolean;
  helpText: string | null;
  analyticsKey: string | null;
  sortOrder: number;
  isActive: boolean;
}

export function ReadingFieldForm({ templateId, sectionId, field, editable }: { templateId: string; sectionId: string; field?: ReadingValues; editable: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveReadingField, {});
  const [type, setType] = useState(field?.valueType ?? 'NUMBER');
  const e = state.fieldErrors ?? {};
  const v = (k: keyof ReadingValues, d = '') => state.values?.[k] ?? (field?.[k] == null ? d : Array.isArray(field[k]) ? (field[k] as string[]).join('\n') : String(field[k]));
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="templateId" value={templateId} />
      <input type="hidden" name="sectionId" value={sectionId} />
      {field?.id ? <input type="hidden" name="id" value={field.id} /> : null}
      <FormMessages state={state} />
      <fieldset disabled={!editable} className="space-y-4">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor="r-code">Code</Label>
            <Input id="r-code" name="code" required maxLength={60} defaultValue={v('code')} />
            <FieldError message={e.code} />
          </div>
          <div className="space-y-1 md:col-span-3">
            <Label htmlFor="r-label">Label</Label>
            <Input id="r-label" name="label" required maxLength={200} defaultValue={v('label')} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="r-type">Value</Label>
            <FormSelect id="r-type" name="valueType" defaultValue={type} onChange={(ev) => setType(ev.target.value)}>
              <option value="NUMBER">Number</option>
              <option value="TEXT">Text</option>
              <option value="SELECT">Choice</option>
            </FormSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="r-unit">Unit</Label>
            <Input id="r-unit" name="unit" maxLength={20} defaultValue={v('unit')} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="r-sort">Order</Label>
            <Input id="r-sort" name="sortOrder" type="number" min={0} max={10000} defaultValue={v('sortOrder', '0')} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="r-key">Analytics key</Label>
            <Input id="r-key" name="analyticsKey" maxLength={80} defaultValue={v('analyticsKey')} />
            <FieldError message={e.analyticsKey} />
          </div>
        </div>
        {type === 'NUMBER' ? (
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="r-min">Minimum</Label>
              <Input id="r-min" name="minValue" type="number" step="any" defaultValue={v('minValue')} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="r-max">Maximum</Label>
              <Input id="r-max" name="maxValue" type="number" step="any" defaultValue={v('maxValue')} />
              <FieldError message={e.maxValue} />
            </div>
            <div className="flex items-end pb-2">
              <Check name="isInteger" label="Whole number" defaultChecked={field?.isInteger ?? false} />
            </div>
          </div>
        ) : null}
        {type === 'SELECT' ? (
          <div className="space-y-1">
            <Label htmlFor="r-options">Options (one per line)</Label>
            <Textarea id="r-options" name="options" defaultValue={v('options')} />
            <FieldError message={e.options} />
          </div>
        ) : null}
        <div className="space-y-1">
          <Label htmlFor="r-help">Help text</Label>
          <Input id="r-help" name="helpText" maxLength={1000} defaultValue={v('helpText')} />
        </div>
        <div className="flex flex-wrap gap-4">
          <Check name="isRequired" label="Required" defaultChecked={field?.isRequired ?? false} />
          <Check name="isActive" label="Active" defaultChecked={field?.isActive ?? true} />
        </div>
      </fieldset>
      {editable ? (
        <div className="flex gap-2">
          <Button type="submit" disabled={pending}>
            {field?.id ? 'Save reading' : 'Add reading'}
          </Button>
          {field?.id ? (
            <Button type="submit" name="op" value="delete" variant="destructive" disabled={pending}>
              Remove reading
            </Button>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}

export function RuleForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(saveRule, {});
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-2">
      <FormMessages state={state} />
      <div className="grid gap-2 md:grid-cols-[1fr_6rem_1fr]">
        <Input name="lhsKey" required placeholder="dc.load_current_a" aria-label="Value" defaultValue={state.values?.lhsKey} />
        <FormSelect name="operator" aria-label="Comparison" defaultValue={state.values?.operator ?? '<='}>
          {['<=', '<', '>=', '>', '='].map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </FormSelect>
        <Input name="rhsKey" required placeholder="dc.rectifier_capacity_a" aria-label="Compared with" defaultValue={state.values?.rhsKey} />
      </div>
      <FieldError message={e.lhsKey ?? e.rhsKey} />
      <Input name="message" required maxLength={255} placeholder="Shown to the technician when the values do not match" aria-label="Message" defaultValue={state.values?.message} />
      <Button type="submit" size="sm" disabled={pending}>
        Add rule
      </Button>
    </form>
  );
}

export function RuleToggle({ id, isActive }: { id: string; isActive: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveRule, {});
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="isActive" value={isActive ? 'false' : 'true'} />
      <button type="submit" disabled={pending} className="text-xs text-info hover:underline">
        {isActive ? 'Switch off' : 'Switch on'}
      </button>
      {state.error ? <span className="ml-2 text-xs text-danger">{state.error}</span> : null}
    </form>
  );
}
