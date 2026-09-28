import * as Notifications from 'expo-notifications';
import { router, type Href } from 'expo-router';
import { useEffect } from 'react';
import { sessionClient } from '@/lib/api/session';
import { notificationRoute } from '@/lib/notification-routes';
import { registerForPush } from '@/lib/push';

/** Registers the phone after sign-in and opens the related screen when a push is tapped. */
export function PushHandler({ pmWork }: { pmWork: boolean }) {
  useEffect(() => {
    void registerForPush();
    const open = (response: Notifications.NotificationResponse) => {
      const data = response.notification.request.content.data as { notificationId?: string; entityType?: string; entityId?: string };
      if (data.notificationId) void sessionClient?.request(`/notifications/${data.notificationId}/read`, { method: 'POST' }).catch(() => undefined);
      const route = notificationRoute(data.entityType, data.entityId, pmWork) ?? '/notifications';
      router.push(route as Href);
    };
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    // A push tapped while the app was closed.
    void Notifications.getLastNotificationResponseAsync().then((r) => r && open(r));
    return () => sub.remove();
  }, [pmWork]);
  return null;
}
