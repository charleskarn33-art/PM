/**
 * Pure logic for sending notifications through the Expo push service (no
 * imports, so it runs unchanged in the Deno Edge Function and in Node tests).
 * https://docs.expo.dev/push-notifications/sending-notifications/
 */

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
/** Expo accepts at most 100 messages per request. */
export const EXPO_BATCH_SIZE = 100;

export interface PendingNotification {
  id: string;
  recipient_id: string;
  type: string;
  title: string;
  body: string | null;
  entity_type: string | null;
  entity_id: string | null;
}

export interface PushToken {
  token: string;
  profile_id: string;
}

export interface ExpoMessage {
  to: string;
  title: string;
  body?: string;
  sound: 'default';
  priority: 'default' | 'high';
  channelId: 'default';
  data: { notification_id: string; entity_type: string | null; entity_id: string | null };
}

export interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

/** Types that need attention straight away are sent with high priority. */
const URGENT = new Set(['CRITICAL_FAILURE', 'PM_REJECTED', 'CORRECTIVE_ACTION_ASSIGNED']);

/** One message per notification per device of its recipient. Recipients without a device get none. */
export function buildMessages(notifications: PendingNotification[], tokens: PushToken[]): ExpoMessage[] {
  const byProfile = new Map<string, string[]>();
  for (const t of tokens) byProfile.set(t.profile_id, [...(byProfile.get(t.profile_id) ?? []), t.token]);
  return notifications.flatMap((n) =>
    (byProfile.get(n.recipient_id) ?? []).map((to) => ({
      to,
      title: n.title,
      ...(n.body ? { body: n.body } : {}),
      sound: 'default' as const,
      priority: URGENT.has(n.type) ? ('high' as const) : ('default' as const),
      channelId: 'default' as const,
      data: { notification_id: n.id, entity_type: n.entity_type, entity_id: n.entity_id },
    })),
  );
}

export function chunk<T>(items: T[], size = EXPO_BATCH_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Reads Expo's tickets (same order as the messages): tokens Expo reports as
 * no longer registered are returned for deletion; other errors are counted.
 */
export function interpretTickets(messages: ExpoMessage[], tickets: ExpoTicket[]): { deadTokens: string[]; errors: number } {
  const deadTokens = new Set<string>();
  let errors = 0;
  tickets.forEach((t, i) => {
    if (t.status !== 'error') return;
    errors += 1;
    const to = messages[i]?.to;
    if (to && t.details?.error === 'DeviceNotRegistered') deadTokens.add(to);
  });
  return { deadTokens: [...deadTokens], errors };
}
