'use server';

import { isUuid, validateInvite, type AppRole, type FieldErrors, type InviteInput } from '@ipt/shared';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireCapability } from '@/lib/auth';
import { formValues, type FormValues } from '@/lib/form-values';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { siteUrl } from '@/lib/site-url';

export interface UserFormState {
  error?: string;
  success?: string;
}

const SCOPED_ROLES: readonly AppRole[] = ['regional_manager', 'regional_supervisor'];

export async function updateUserAccess(_prev: UserFormState, formData: FormData): Promise<UserFormState> {
  await requireCapability('manage_users');
  const userId = String(formData.get('user_id') ?? '');
  const role = String(formData.get('role') ?? '') as AppRole;
  const isActive = formData.get('is_active') === 'true';
  const regionId = String(formData.get('region_id') ?? '') || null;
  const scopes = formData.getAll('scope_region_ids').map(String).filter(isUuid);
  if (!isUuid(userId)) return { error: 'Invalid user.' };
  if (regionId && !isUuid(regionId)) return { error: 'Invalid region.' };

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_update_user', {
    p_user_id: userId,
    p_role: role,
    p_is_active: isActive,
    p_region_id: regionId ?? undefined,
  });
  if (error) return { error: `Unable to update access: ${error.message}` };

  const { error: scopeError } = await supabase.rpc('admin_set_region_scopes', {
    p_user_id: userId,
    p_region_ids: SCOPED_ROLES.includes(role) ? scopes : [],
  });
  if (scopeError) return { error: `Access saved, but region scope failed: ${scopeError.message}` };

  revalidatePath('/admin/users');
  revalidatePath(`/admin/users/${userId}`);
  return { success: 'Access updated.' };
}

export async function updateRoleDetails(_prev: UserFormState, formData: FormData): Promise<UserFormState> {
  await requireCapability('manage_users');
  const userId = String(formData.get('user_id') ?? '');
  const kind = String(formData.get('kind') ?? '');
  const employeeCode = String(formData.get('employee_code') ?? '').trim() || null;
  if (!isUuid(userId)) return { error: 'Invalid user.' };
  const supabase = await createClient();

  let error;
  if (kind === 'technician') {
    const supervisorId = String(formData.get('supervisor_id') ?? '') || null;
    const regionId = String(formData.get('technician_region_id') ?? '') || null;
    ({ error } = await supabase
      .from('technicians')
      .update({ employee_code: employeeCode, supervisor_id: supervisorId, region_id: regionId })
      .eq('id', userId));
  } else if (kind === 'supervisor') {
    ({ error } = await supabase.from('supervisors').update({ employee_code: employeeCode }).eq('id', userId));
  } else {
    return { error: 'Unknown details type.' };
  }
  if (error) {
    if (error.code === '23505') return { error: 'This employee code is already in use.' };
    return { error: `Unable to save details: ${error.message}` };
  }
  revalidatePath(`/admin/users/${userId}`);
  return { success: 'Details saved.' };
}

export interface InviteState {
  error?: string;
  fieldErrors?: FieldErrors<keyof InviteInput>;
  values?: FormValues;
}

export async function inviteUser(_prev: InviteState, formData: FormData): Promise<InviteState> {
  await requireCapability('manage_users');
  const values = formValues(formData);
  const result = validateInvite(values);
  if (!result.ok) return { error: 'Please correct the highlighted fields.', fieldErrors: result.errors, values };
  const { email, full_name, role, region_id } = result.value;

  const admin = createAdminClient();
  if (!admin) return { error: 'Invitations are not configured: set SUPABASE_SECRET_KEY on the server.', values };

  const redirectTo = `${await siteUrl()}/auth/confirm?next=/auth/set-password`;
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { data: { full_name }, redirectTo });
  if (error) {
    return /already/i.test(error.message)
      ? { fieldErrors: { email: 'A user with this email already exists.' }, values }
      : { error: `Unable to send the invitation: ${error.message}`, values };
  }

  // Assign role and activate as the signed-in admin so the change is audited.
  const supabase = await createClient();
  const { error: roleError } = await supabase.rpc('admin_update_user', {
    p_user_id: data.user.id,
    p_role: role,
    p_is_active: true,
    p_region_id: region_id ?? undefined,
  });
  if (roleError) {
    return { error: `Invitation sent, but assigning the role failed: ${roleError.message}. Edit the user to retry.` };
  }
  revalidatePath('/admin/users');
  redirect(`/admin/users/${data.user.id}?invited=1`);
}
