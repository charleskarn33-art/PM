// Supabase Edge Function: sends pending in-app notifications as Expo push
// notifications, then marks them sent. Runs with the service role on the
// server only; the key never reaches a client.
//
// Invoke on a schedule (pg_cron + pg_net) or from a Database Webhook on
// `notifications` inserts; see docs/SETUP.md. Requests must carry
// `Authorization: Bearer <PUSH_FUNCTION_SECRET>`.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { buildMessages, chunk, EXPO_PUSH_URL, interpretTickets, type ExpoTicket, type PendingNotification } from '../_shared/expo-push.ts';

const MAX_PER_RUN = 500;

Deno.serve(async (req) => {
  const secret = Deno.env.get('PUSH_FUNCTION_SECRET');
  if (!secret || req.headers.get('Authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  // Only recent notifications: an old backlog is not worth a late buzz.
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data: pending, error } = await supabase
    .from('notifications')
    .select('id, recipient_id, type, title, body, entity_type, entity_id')
    .is('push_sent_at', null)
    .gte('created_at', since)
    .order('created_at')
    .limit(MAX_PER_RUN);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const notifications = (pending ?? []) as PendingNotification[];
  if (notifications.length === 0) return Response.json({ sent: 0 });

  const recipients = [...new Set(notifications.map((n) => n.recipient_id))];
  const { data: tokens, error: tokenError } = await supabase.from('push_tokens').select('token, profile_id').in('profile_id', recipients);
  if (tokenError) return Response.json({ error: tokenError.message }, { status: 500 });

  const messages = buildMessages(notifications, tokens ?? []);
  const accessToken = Deno.env.get('EXPO_ACCESS_TOKEN');
  let errors = 0;
  const dead: string[] = [];
  for (const batch of chunk(messages)) {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      // Leave everything unsent; the next run retries.
      return Response.json({ error: `Expo push service answered ${res.status}` }, { status: 502 });
    }
    const body = (await res.json()) as { data?: ExpoTicket[] };
    const result = interpretTickets(batch, body.data ?? []);
    errors += result.errors;
    dead.push(...result.deadTokens);
  }

  if (dead.length) await supabase.from('push_tokens').delete().in('token', dead);
  // Marked sent even for recipients without a device: they read it in the app.
  const { error: markError } = await supabase
    .from('notifications')
    .update({ push_sent_at: new Date().toISOString() })
    .in('id', notifications.map((n) => n.id));
  if (markError) return Response.json({ error: markError.message }, { status: 500 });
  return Response.json({ notifications: notifications.length, messages: messages.length, errors, removedTokens: dead.length });
});
