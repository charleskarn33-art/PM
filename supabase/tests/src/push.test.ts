import { describe, expect, it } from 'vitest';
import { buildMessages, chunk, interpretTickets, type PendingNotification } from '../../functions/_shared/expo-push';

const n = (id: string, recipient: string, type = 'PM_APPROVED', body: string | null = 'b'): PendingNotification => ({
  id,
  recipient_id: recipient,
  type,
  title: `t-${id}`,
  body,
  entity_type: 'pm_visit',
  entity_id: `e-${id}`,
});

describe('Expo push message building (send-push Edge Function)', () => {
  it('sends each notification to every device of its recipient only', () => {
    const messages = buildMessages(
      [n('1', 'u1'), n('2', 'u2', 'CRITICAL_FAILURE', null), n('3', 'nobody')],
      [
        { token: 'ExponentPushToken[a]', profile_id: 'u1' },
        { token: 'ExponentPushToken[b]', profile_id: 'u1' },
        { token: 'ExponentPushToken[c]', profile_id: 'u2' },
      ],
    );
    expect(messages.map((m) => [m.to, m.title, m.priority])).toEqual([
      ['ExponentPushToken[a]', 't-1', 'default'],
      ['ExponentPushToken[b]', 't-1', 'default'],
      ['ExponentPushToken[c]', 't-2', 'high'],
    ]);
    expect(messages[2]).not.toHaveProperty('body');
    expect(messages[0]!.data).toEqual({ notification_id: '1', entity_type: 'pm_visit', entity_id: 'e-1' });
  });

  it('batches by 100 and drops tokens Expo reports as unregistered', () => {
    expect(chunk(Array.from({ length: 250 }, (_, i) => i)).map((c) => c.length)).toEqual([100, 100, 50]);
    const messages = buildMessages([n('1', 'u1')], [
      { token: 'ExponentPushToken[a]', profile_id: 'u1' },
      { token: 'ExponentPushToken[b]', profile_id: 'u1' },
    ]);
    expect(
      interpretTickets(messages, [
        { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
        { status: 'error', message: 'rate', details: { error: 'MessageRateExceeded' } },
      ]),
    ).toEqual({ deadTokens: ['ExponentPushToken[a]'], errors: 2 });
  });
});
