'use server';

import { isUuid } from '@ipt/shared';
import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export async function markNotificationRead(formData: FormData): Promise<void> {
  await requireSession();
  const id = String(formData.get('id') ?? '');
  if (!isUuid(id)) return;
  const supabase = await createClient();
  await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id).is('read_at', null);
  revalidatePath('/', 'layout');
}

export async function markAllNotificationsRead(): Promise<void> {
  await requireSession();
  const supabase = await createClient();
  await supabase.rpc('mark_all_notifications_read');
  revalidatePath('/', 'layout');
}
