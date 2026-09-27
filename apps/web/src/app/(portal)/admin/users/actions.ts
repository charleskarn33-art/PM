'use server';

import { redirect } from 'next/navigation';
import { ApiError } from '@/lib/api/client';
import { api } from '@/lib/api/server';
import { requirePermission } from '@/lib/auth';
import { fieldErrorsOf, messageOf, submit, text, type FormState } from '@/lib/form-action';
import { formValues } from '@/lib/form-values';

const list = (formData: FormData, key: string) => formData.getAll(key).map(String).filter(Boolean);

export async function createUser(_prev: FormState, formData: FormData): Promise<FormState> {
  await requirePermission('users.manage');
  let id: string;
  try {
    id = (
      await api<{ id: string }>('/users', {
        body: {
          email: text(formData, 'email') ?? '',
          fullName: text(formData, 'fullName') ?? '',
          phone: text(formData, 'phone', true),
          employeeCode: text(formData, 'employeeCode', true),
          roles: list(formData, 'roles'),
          homeRegionId: text(formData, 'homeRegionId', true),
          regionScopeIds: list(formData, 'regionScopeIds'),
        },
      })
    ).data.id;
  } catch (e) {
    return { error: messageOf(e), fieldErrors: e instanceof ApiError ? fieldErrorsOf(e) : undefined, values: formValues(formData) };
  }
  const temporaryPassword = String(formData.get('temporaryPassword') ?? '');
  if (temporaryPassword) {
    try {
      await api(`/users/${id}/temporary-password`, { body: { temporaryPassword } });
    } catch (e) {
      // The account exists; the password can be set again from its page.
      redirect(`/admin/users/${id}?created=1&passwordError=${encodeURIComponent(messageOf(e))}`);
    }
  }
  redirect(`/admin/users/${id}?created=1`);
}

const at = (id: string) => [`/admin/users/${id}`, '/admin/users'];

export async function updateUser(_prev: FormState, formData: FormData): Promise<FormState> {
  await requirePermission('users.manage');
  const id = text(formData, 'id') ?? '';
  return submit(
    formData,
    () =>
      api(`/users/${id}`, {
        method: 'PATCH',
        body: { fullName: text(formData, 'fullName'), phone: text(formData, 'phone', true), employeeCode: text(formData, 'employeeCode', true), homeRegionId: text(formData, 'homeRegionId', true) },
      }),
    'Details saved.',
    at(id),
  );
}

export async function setRoles(_prev: FormState, formData: FormData): Promise<FormState> {
  await requirePermission('users.manage');
  const id = text(formData, 'id') ?? '';
  return submit(formData, () => api(`/users/${id}/roles`, { method: 'PUT', body: { roles: list(formData, 'roles') } }), 'Roles saved.', at(id));
}

export async function setRegions(_prev: FormState, formData: FormData): Promise<FormState> {
  await requirePermission('users.manage');
  const id = text(formData, 'id') ?? '';
  return submit(formData, () => api(`/users/${id}/region-scopes`, { method: 'PUT', body: { regionIds: list(formData, 'regionIds') } }), 'Regions saved.', at(id));
}

export async function accountStep(_prev: FormState, formData: FormData): Promise<FormState> {
  await requirePermission('users.manage');
  const id = text(formData, 'id') ?? '';
  const step = text(formData, 'step');
  if (step === 'temporary-password') {
    return submit(formData, () => api(`/users/${id}/temporary-password`, { body: { temporaryPassword: String(formData.get('temporaryPassword') ?? '') } }), 'Temporary password set. Every session of this user was signed out; they must choose a new password at their next sign-in.', at(id));
  }
  if (step !== 'activate' && step !== 'deactivate' && step !== 'unlock') return { error: 'Unknown step.' };
  const done = { activate: 'Account activated.', deactivate: 'Account deactivated and signed out everywhere.', unlock: 'Sign-in unlocked.' }[step];
  return submit(formData, () => api(`/users/${id}/${step}`, { method: 'POST' }), done, at(id));
}
