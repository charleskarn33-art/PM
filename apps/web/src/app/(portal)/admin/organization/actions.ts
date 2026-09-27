'use server';

import { api } from '@/lib/api/server';
import { requirePermission } from '@/lib/auth';
import { submit, text, type FormState } from '@/lib/form-action';

const PATH = { region: 'regions', cluster: 'clusters', county: 'counties' } as const;
const PARENT = { region: null, cluster: 'regionId', county: 'clusterId' } as const;

/** Creates or edits a region, cluster or county (`kind`, optional `id`). */
export async function saveOrgUnit(_prev: FormState, formData: FormData): Promise<FormState> {
  await requirePermission('org.manage');
  const kind = text(formData, 'kind') as keyof typeof PATH;
  if (!(kind in PATH)) return { error: 'Unknown kind.' };
  const id = text(formData, 'id');
  const body: Record<string, unknown> = { code: text(formData, 'code') ?? '', name: text(formData, 'name') ?? '', isActive: formData.get('isActive') === 'on' };
  const parent = PARENT[kind];
  if (!id && parent) body[parent] = text(formData, 'parentId');
  return submit(formData, () => api(id ? `/${PATH[kind]}/${id}` : `/${PATH[kind]}`, { method: id ? 'PATCH' : 'POST', body }), id ? 'Saved.' : 'Created.', ['/admin/organization']);
}
