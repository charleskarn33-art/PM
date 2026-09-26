import { useCallback, useEffect, useState } from 'react';
import { useOffline } from '@/offline/offline-provider';
import { errorMessage } from './errors';
import { sessionClient } from './session';
import { ApiError } from './session-client';

export { errorMessage };

export interface ApiQuery<T> {
  data: T | null;
  meta: Record<string, unknown> | undefined;
  error: string | null;
  loading: boolean;
  refreshing: boolean;
  /** Set when there is no connection and the copy saved on the phone is shown (when it was saved). */
  savedAt: string | null;
  reload: () => Promise<void>;
}

interface State<T> {
  path: string | null;
  data: T | null;
  meta?: Record<string, unknown>;
  error: string | null;
  loaded: boolean;
  savedAt: string | null;
}

/**
 * Loads an API path (null: nothing to load); `reload` for pull-to-refresh.
 * Each answer is saved on the phone; without a connection the saved copy is
 * shown instead (with the time it was saved).
 */
export function useApi<T>(path: string | null): ApiQuery<T> {
  const { store } = useOffline();
  const [state, setState] = useState<State<T>>({ path, data: null, error: null, loaded: false, savedAt: null });
  const [refreshing, setRefreshing] = useState(false);
  // A new path starts from scratch (adjusting state while rendering, not in an effect).
  if (state.path !== path) setState({ path, data: null, error: null, loaded: false, savedAt: null });

  const load = useCallback(async () => {
    if (!path || !sessionClient) return;
    const key = `api:${path}`;
    try {
      const r = await sessionClient.request<T>(path);
      setState((s) => (s.path === path ? { path, data: r.data, meta: r.meta, error: null, loaded: true, savedAt: null } : s));
      await store?.setCache(key, { data: r.data, meta: r.meta }).catch(() => undefined);
    } catch (e) {
      const saved = e instanceof ApiError && e.offline && store ? await store.getCache<{ data: T; meta?: Record<string, unknown> }>(key).catch(() => null) : null;
      setState((s) =>
        s.path !== path
          ? s
          : saved
            ? { path, data: saved.data.data, meta: saved.data.meta, error: null, loaded: true, savedAt: saved.savedAt }
            : { ...s, error: errorMessage(e), loaded: true },
      );
    }
  }, [path, store]);

  useEffect(() => {
    void load();
  }, [load]);

  return {
    data: state.data,
    meta: state.meta,
    error: state.error,
    loading: Boolean(path) && !state.loaded,
    refreshing,
    savedAt: state.savedAt,
    reload: async () => {
      setRefreshing(true);
      await load();
      setRefreshing(false);
    },
  };
}
