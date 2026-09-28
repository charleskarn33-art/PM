'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { api } from '@/lib/api/server';
import { requireSession } from '@/lib/auth';
import { notificationHref } from './links';

/** Marks the notification read and opens what it is about (bound on the server: id, type and record id). */
export async function openNotification(id: string, entityType: string | null, entityId: string | null) {
  await requireSession();
  await api(`/notifications/${id}/read`, { method: 'POST' }).catch(() => undefined);
  revalidatePath('/notifications');
  redirect(notificationHref(entityType, entityId) ?? '/notifications');
}

export async function markAllRead() {
  await requireSession();
  await api('/notifications/read-all', { method: 'POST' });
  revalidatePath('/notifications');
}
