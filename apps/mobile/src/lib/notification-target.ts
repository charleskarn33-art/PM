import type { Href } from 'expo-router';
import type { AppNotification } from '@/offline/types';

/** Where a notification leads in the app (null when there is no screen for it on the phone). */
export function notificationTarget(n: Pick<AppNotification, 'entity_type' | 'entity_id'>): Href | null {
  if (!n.entity_id) return null;
  switch (n.entity_type) {
    case 'corrective_action':
      return { pathname: '/action/[id]', params: { id: n.entity_id } };
    case 'pm_visit':
      return { pathname: '/pm/[visitId]', params: { visitId: n.entity_id } };
    case 'pm_schedule':
      return '/pm';
    case 'site':
      return { pathname: '/site/[id]', params: { id: n.entity_id } };
    default:
      return null;
  }
}
