'use server';

import { redirect } from 'next/navigation';
import { ApiError } from '@/lib/api/client';
import { api } from '@/lib/api/server';
import { requireSession } from '@/lib/auth';
import { fieldErrorsOf, messageOf, submit, text, type FormState } from '@/lib/form-action';
import { formValues } from '@/lib/form-values';

const num = (formData: FormData, key: string): number | null => {
  const v = text(formData, key);
  return v === undefined ? null : Number(v);
};

/** Creates a site or saves changes; the API validates and returns field problems. */
export async function saveSite(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireSession();
  const id = text(formData, 'id');
  const body = {
    siteCode: text(formData, 'siteCode') ?? '',
    siteName: text(formData, 'siteName') ?? '',
    regionId: text(formData, 'regionId'),
    clusterId: text(formData, 'clusterId', true),
    countyId: text(formData, 'countyId', true),
    latitude: num(formData, 'latitude'),
    longitude: num(formData, 'longitude'),
    address: text(formData, 'address', true),
    siteType: text(formData, 'siteType', true),
    status: text(formData, 'status'),
    generatorAvailable: formData.get('generatorAvailable') === 'on',
    solarAvailable: formData.get('solarAvailable') === 'on',
    gridAvailable: formData.get('gridAvailable') === 'on',
    batteryConfiguration: text(formData, 'batteryConfiguration', true),
    powerConfiguration: text(formData, 'powerConfiguration', true),
    batteryUnitCount: num(formData, 'batteryUnitCount'),
    geofenceRadiusM: num(formData, 'geofenceRadiusM'),
  };
  let savedId: string;
  try {
    savedId = (await api<{ id: string }>(id ? `/sites/${id}` : '/sites', { method: id ? 'PATCH' : 'POST', body })).data.id;
  } catch (e) {
    return { error: messageOf(e), fieldErrors: e instanceof ApiError ? fieldErrorsOf(e) : undefined, values: formValues(formData) };
  }
  redirect(`/sites/${savedId}`);
}

export async function assignToSite(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireSession();
  const siteId = text(formData, 'siteId') ?? '';
  const role = text(formData, 'role') ?? 'TECHNICIAN';
  return submit(
    formData,
    () => api('/assignments', { body: { siteId, userId: text(formData, 'userId'), role, startDate: text(formData, 'startDate') } }),
    role === 'SUPERVISOR' ? 'Supervisor appointed.' : 'Technician assigned.',
    [`/sites/${siteId}`],
  );
}

export async function endAssignment(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireSession();
  const siteId = text(formData, 'siteId') ?? '';
  return submit(
    formData,
    () => api(`/assignments/${text(formData, 'assignmentId')}/end`, { body: { endDate: text(formData, 'endDate'), reason: text(formData, 'reason') } }),
    'Assignment ended.',
    [`/sites/${siteId}`],
  );
}
