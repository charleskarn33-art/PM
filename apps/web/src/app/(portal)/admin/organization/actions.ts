'use server';

import { validateOrgUnit } from '@ipt/shared';
import { revalidatePath } from 'next/cache';
import { requireCapability } from '@/lib/auth';
import { formValues, type FormValues } from '@/lib/form-values';
import { createClient } from '@/lib/supabase/server';

export type OrgKind = 'region' | 'cluster' | 'county';

export interface OrgFormState {
  error?: string;
  success?: string;
  fieldErrors?: Partial<Record<'code' | 'name' | 'parent_id', string>>;
  values?: FormValues;
}

const LABEL: Record<OrgKind, string> = { region: 'Region', cluster: 'Cluster', county: 'County' };

export async function saveOrgUnit(_prev: OrgFormState, formData: FormData): Promise<OrgFormState> {
  await requireCapability('manage_organization');
  const kind = String(formData.get('kind')) as OrgKind;
  if (!['region', 'cluster', 'county'].includes(kind)) return { error: 'Unknown item type.' };
  const id = String(formData.get('id') ?? '');
  const values = formValues(formData);
  const result = validateOrgUnit(values, kind !== 'region');
  if (!result.ok) return { error: 'Please correct the highlighted fields.', fieldErrors: result.errors, values };
  const { code, name, parent_id, is_active } = result.value;

  const supabase = await createClient();
  let error: { code?: string; message: string } | null = null;
  if (kind === 'region') {
    const row = { code, name, is_active };
    ({ error } = id
      ? await supabase.from('regions').update(row).eq('id', id)
      : await supabase.from('regions').insert(row));
  } else if (kind === 'cluster') {
    const row = { code, name, is_active, region_id: parent_id! };
    ({ error } = id
      ? await supabase.from('clusters').update(row).eq('id', id)
      : await supabase.from('clusters').insert(row));
  } else {
    const row = { code, name, is_active, cluster_id: parent_id! };
    ({ error } = id
      ? await supabase.from('counties').update(row).eq('id', id)
      : await supabase.from('counties').insert(row));
  }
  if (error) {
    if (error.code === '23505') return { fieldErrors: { code: 'This code or name is already in use.' }, values };
    return { error: `Unable to save ${LABEL[kind].toLowerCase()}: ${error.message}`, values };
  }
  revalidatePath('/admin/organization');
  return { success: `${LABEL[kind]} ${id ? 'updated' : 'created'}.` };
}
