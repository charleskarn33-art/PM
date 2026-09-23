import type { Database } from '@ipt/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { classifyError, classifyThrown } from './errors';
import { SyncError, type SyncTransport } from './sync';
import { ACTION_ORDER, type ActionStatus, type PhotoUploadPayload, type SyncBundle } from './types';

type Client = SupabaseClient<Database>;
type Result = { error: { message: string; code?: string } | null; status: number };

const fail = (r: Result) => classifyError({ message: r.error!.message, code: r.error!.code, status: r.status });

/** Runs a request, turning thrown fetch errors and error results into SyncErrors. */
async function call<T extends Result>(request: PromiseLike<T>): Promise<T> {
  let r: T;
  try {
    r = await request;
  } catch (e) {
    throw classifyThrown(e);
  }
  return r;
}

/** Reads a local file (expo-file-system on the phone). */
export type ReadFile = (uri: string) => Promise<ArrayBuffer>;

async function readBytes(readFile: ReadFile, uri: string): Promise<ArrayBuffer> {
  try {
    return await readFile(uri);
  } catch (e) {
    throw new SyncError('rejected', `The photo file is missing on this phone (${e instanceof Error ? e.message : String(e)}).`);
  }
}

/** SyncTransport over Supabase (PostgREST + Storage). Every call is safe to repeat. */
export function supabaseTransport(client: Client, readFile: ReadFile): SyncTransport {
  async function visitStatus(visitId: string) {
    const r = await call(client.from('pm_visits').select('status').eq('id', visitId).maybeSingle());
    if (r.error) throw fail(r);
    return r.data?.status ?? null;
  }

  return {
    async createVisit(payload) {
      const r = await call(client.from('pm_visits').insert(payload as Database['public']['Tables']['pm_visits']['Insert']));
      if (!r.error) return;
      if (r.error.code === '23505') {
        // Already created by an earlier attempt — unless the conflict is another visit for the same schedule.
        if ((await visitStatus(payload.id as string)) != null) return;
        throw new SyncError('rejected', 'Another PM visit already exists for this schedule.');
      }
      throw fail(r);
    },

    async updateVisit(visitId, patch) {
      const r = await call(
        client.from('pm_visits').update(patch as Database['public']['Tables']['pm_visits']['Update']).eq('id', visitId).select('id'),
      );
      if (r.error) throw fail(r);
      if (!r.data?.length) throw new SyncError('rejected', 'This PM is no longer available to you.');
    },

    async submitVisit(visitId, patch) {
      const r = await call(
        client.from('pm_visits').update(patch as Database['public']['Tables']['pm_visits']['Update']).eq('id', visitId).select('id'),
      );
      if (!r.error && r.data?.length) return;
      if (r.error && fail(r).kind === 'network') throw fail(r);
      const status = await visitStatus(visitId);
      if (status === 'SUBMITTED' || status === 'APPROVED') return;
      if (r.error) throw fail(r);
      throw new SyncError('rejected', 'This PM is no longer available to you.');
    },

    async upsertResponse(payload) {
      const r = await call(
        client
          .from('pm_responses')
          .upsert(payload as Database['public']['Tables']['pm_responses']['Insert'], { onConflict: 'visit_id,checklist_item_id' }),
      );
      if (r.error) throw fail(r);
    },

    async upsertReading(payload) {
      const r = await call(
        client
          .from('pm_readings')
          .upsert(payload as Database['public']['Tables']['pm_readings']['Insert'], { onConflict: 'visit_id,reading_field_id' }),
      );
      if (r.error) throw fail(r);
    },

    async uploadPhoto({ row, local_uri, thumb_uri }: PhotoUploadPayload) {
      // Already recorded (an earlier attempt succeeded but its response was lost):
      // done. The stored file is evidence from then on and cannot be replaced.
      const existing = await call(client.from('pm_photos').select('id').eq('id', row.id).maybeSingle());
      if (existing.error && fail(existing).kind === 'network') throw fail(existing);
      if (existing.data) return;
      // Files first: the metadata row is refused until the file exists in storage.
      const bucket = client.storage.from('pm-photos');
      const files: [string, string][] = [[row.file_path, local_uri]];
      if (thumb_uri && row.thumbnail_path) files.push([row.thumbnail_path, thumb_uri]);
      for (const [path, uri] of files) {
        const bytes = await readBytes(readFile, uri);
        let res: Awaited<ReturnType<typeof bucket.upload>>;
        try {
          res = await bucket.upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
        } catch (e) {
          throw classifyThrown(e);
        }
        if (res.error) {
          const status = 'status' in res.error ? Number((res.error as { status: unknown }).status) : 0;
          throw classifyError({ message: res.error.message, status: Number.isFinite(status) ? status : 0 });
        }
      }
      const r = await call(client.from('pm_photos').insert(row));
      if (r.error && r.error.code !== '23505') throw fail(r);
    },

    async updateAction(actionId, patch) {
      const r = await call(
        client.from('corrective_actions').update(patch as Database['public']['Tables']['corrective_actions']['Update']).eq('id', actionId).select('id'),
      );
      if (!r.error && r.data?.length) return;
      if (r.error && fail(r).kind === 'network') throw fail(r);
      // Resent after the app was killed, or the supervisor already moved it on: done if at or past the target.
      const cur = await call(client.from('corrective_actions').select('status').eq('id', actionId).maybeSingle());
      if (cur.error) throw fail(cur);
      const target = patch.status as ActionStatus | undefined;
      if (cur.data && target && ACTION_ORDER.indexOf(cur.data.status) >= ACTION_ORDER.indexOf(target)) return;
      if (r.error) throw fail(r);
      throw new SyncError('rejected', 'This corrective action is no longer assigned to you.');
    },

    async addActionNote(payload) {
      const r = await call(
        client.from('corrective_action_updates').insert({
          id: payload.id as string,
          corrective_action_id: payload.corrective_action_id as string,
          note: payload.note as string,
        }),
      );
      if (r.error && r.error.code !== '23505') throw fail(r);
    },

    async markNotificationRead(id, readAt) {
      const r = await call(client.from('notifications').update({ read_at: readAt }).eq('id', id));
      if (r.error) throw fail(r);
    },

    async fetchBundle() {
      const r = await call(client.rpc('mobile_sync_bundle'));
      if (r.error) throw fail(r);
      return r.data as unknown as SyncBundle;
    },
  };
}
