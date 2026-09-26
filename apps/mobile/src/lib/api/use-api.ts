import { useCallback, useEffect, useState } from 'react';
import { sessionClient } from './session';
import { ApiError } from './session-client';

export interface ApiQuery<T> {
  data: T | null;
  meta: Record<string, unknown> | undefined;
  error: string | null;
  loading: boolean;
  refreshing: boolean;
  reload: () => Promise<void>;
}

/** A user-facing message for an API error. */
export function errorMessage(e: unknown, action = 'load this'): string {
  if (e instanceof ApiError) {
    if (e.offline) return `No connection. Connect to ${action}.`;
    if (e.status < 500) return e.message;
  }
  return `Unable to ${action} right now. Try again in a moment.`;
}

/** Loads an API path (null: nothing to load); `reload` for pull-to-refresh. */
export function useApi<T>(path: string | null): ApiQuery<T> {
  const [state, setState] = useState<{ path: string | null; data: T | null; meta?: Record<string, unknown>; error: string | null; loaded: boolean }>({
    path,
    data: null,
    error: null,
    loaded: false,
  });
  const [refreshing, setRefreshing] = useState(false);
  // A new path starts from scratch (adjusting state while rendering, not in an effect).
  if (state.path !== path) setState({ path, data: null, error: null, loaded: false });

  const load = useCallback(async () => {
    if (!path || !sessionClient) return;
    try {
      const r = await sessionClient.request<T>(path);
      setState((s) => (s.path === path ? { path, data: r.data, meta: r.meta, error: null, loaded: true } : s));
    } catch (e) {
      setState((s) => (s.path === path ? { ...s, error: errorMessage(e), loaded: true } : s));
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  return {
    data: state.data,
    meta: state.meta,
    error: state.error,
    loading: Boolean(path) && !state.loaded,
    refreshing,
    reload: async () => {
      setRefreshing(true);
      await load();
      setRefreshing(false);
    },
  };
}
