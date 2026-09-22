import { useCallback, useEffect, useRef, useState } from 'react';

export interface RemoteQuery<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  refreshing: boolean;
  refresh: () => void;
}

export function describeError(e: unknown): string {
  if (e instanceof Error) {
    return /network|fetch/i.test(e.message)
      ? 'No Internet connection. Pull down to retry when you are back online.'
      : e.message;
  }
  return 'Unexpected error.';
}

/**
 * Runs an online Supabase query with loading / refresh / error state.
 * `key` identifies the query inputs: when it changes, the query re-runs.
 * (Offline-first reads from the local SQLite store replace this in Phase 5.)
 */
export function useRemoteQuery<T>(fetcher: () => Promise<T>, key: string): RemoteQuery<T> {
  const [result, setResult] = useState<{ data?: T; error: string | null; loading: boolean }>({
    error: null,
    loading: true,
  });
  const [refreshing, setRefreshing] = useState(false);
  const [version, setVersion] = useState(0);
  const fetcherRef = useRef(fetcher);

  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  useEffect(() => {
    let cancelled = false;
    fetcherRef
      .current()
      .then(
        (data) => {
          if (!cancelled) setResult({ data, error: null, loading: false });
        },
        (e: unknown) => {
          if (!cancelled) setResult((prev) => ({ ...prev, error: describeError(e), loading: false }));
        },
      )
      .finally(() => {
        if (!cancelled) setRefreshing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [key, version]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    setVersion((v) => v + 1);
  }, []);

  return { data: result.data, error: result.error, loading: result.loading, refreshing, refresh };
}
