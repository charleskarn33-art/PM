import { File } from 'expo-file-system';
import { addNetworkStateListener, getNetworkStateAsync } from 'expo-network';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { notificationTarget } from '@/lib/notification-target';
import { registerForPush, type PushData, type PushRegistration } from '@/lib/push';
import { supabase } from '@/lib/supabase';
import { openLocalDb } from '@/offline/expo-db';
import { LocalStore, type OutboxSummary } from '@/offline/store';
import { supabaseTransport } from '@/offline/supabase-transport';
import { SyncEngine, type SyncResult } from '@/offline/sync';
import { useAuth } from './auth-provider';

/** Sync while the app is open even if nothing else triggers it. */
const SYNC_INTERVAL_MS = 5 * 60_000;
/** Group quick successive edits into one sync. */
const WRITE_DEBOUNCE_MS = 3_000;

export interface SyncStatus {
  syncing: boolean;
  online: boolean | null;
  lastSyncedAt: string | null;
  lastResult: SyncResult | null;
  outbox: OutboxSummary;
}

interface OfflineContextValue {
  store: LocalStore | null;
  /** Local store failed to open (the phone cannot work offline). */
  storeError: string | null;
  /** Increments whenever local data changes; screens re-read on change. */
  revision: number;
  status: SyncStatus;
  /** Result of registering this phone for push notifications (null until tried). */
  push: PushRegistration | null;
  syncNow: () => Promise<void>;
  /** Call after writing to the store: refreshes screens and schedules a sync. */
  changed: () => void;
  deleteFiles: (uris: string[]) => void;
}

const readLocalFile = (uri: string) => new File(uri).arrayBuffer();

const EMPTY_OUTBOX: OutboxSummary = { pending: 0, errors: [], nextAttemptAt: null };
const OfflineContext = createContext<OfflineContextValue | null>(null);

function deleteFiles(uris: string[]) {
  for (const uri of uris) {
    try {
      const f = new File(uri);
      if (f.exists) f.delete();
    } catch (e) {
      console.warn('Could not delete local photo file', uri, e);
    }
  }
}

/**
 * Owns the phone's offline store and keeps it in step with the server:
 * syncs when signed in, when the app returns to the foreground, when the
 * network comes back, shortly after local edits, every few minutes, and on
 * request. Clears the phone's copy on sign-out unless work is unsent.
 */
export function OfflineProvider({ children }: { children: ReactNode }) {
  const { session, status: authStatus } = useAuth();
  const userId = session?.user.id ?? null;
  const [store, setStore] = useState<LocalStore | null>(null);
  const [storeError, setStoreError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState<SyncStatus>({
    syncing: false,
    online: null,
    lastSyncedAt: null,
    lastResult: null,
    outbox: EMPTY_OUTBOX,
  });
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasOnline = useRef<boolean | null>(null);
  const [push, setPush] = useState<PushRegistration | null>(null);
  const router = useRouter();

  useEffect(() => {
    openLocalDb().then(
      (db) => setStore(new LocalStore(db)),
      (e: unknown) => setStoreError(e instanceof Error ? e.message : String(e)),
    );
  }, []);

  const engine = useMemo(
    () => (store && supabase && userId ? new SyncEngine(store, supabaseTransport(supabase, readLocalFile), userId) : null),
    [store, userId],
  );

  const refreshStatus = useCallback(async () => {
    if (!store) return;
    const [outbox, lastSyncedAt] = await Promise.all([store.summary(), store.lastSyncedAt()]);
    setStatus((s) => ({ ...s, outbox, lastSyncedAt }));
  }, [store]);

  const run = useCallback(
    async (force: boolean) => {
      if (!engine) return;
      setStatus((s) => ({ ...s, syncing: true }));
      try {
        const result = await engine.run({ force });
        deleteFiles(result.removedFiles);
        setStatus((s) => ({ ...s, lastResult: result }));
      } finally {
        setStatus((s) => ({ ...s, syncing: false }));
        await refreshStatus();
        setRevision((r) => r + 1);
      }
    },
    [engine, refreshStatus],
  );

  // Signed in (or store ready): first sync. Signed out: clear the phone's copy if safe.
  useEffect(() => {
    if (!store) return;
    if (authStatus === 'signed-in' && engine) {
      const t = setTimeout(() => void run(false), 0);
      return () => clearTimeout(t);
    }
    if (authStatus === 'signed-out') {
      void store.clearForSignOut().then(({ removedFiles }) => {
        deleteFiles(removedFiles);
        void refreshStatus();
        setRevision((r) => r + 1);
      });
    }
  }, [authStatus, engine, store, run, refreshStatus]);

  useEffect(() => {
    if (!engine) return;
    const appSub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void run(false);
    });
    const netSub = addNetworkStateListener((n) => {
      const online = Boolean(n.isConnected && n.isInternetReachable !== false);
      // Coming back online: send what is waiting straight away (skip the back-off wait).
      if (online && wasOnline.current === false) void run(true);
      wasOnline.current = online;
      setStatus((s) => ({ ...s, online }));
    });
    void getNetworkStateAsync().then((n) => {
      const online = Boolean(n.isConnected && n.isInternetReachable !== false);
      wasOnline.current = online;
      setStatus((s) => ({ ...s, online }));
    });
    const timer = setInterval(() => void run(false), SYNC_INTERVAL_MS);
    return () => {
      appSub.remove();
      netSub.remove();
      clearInterval(timer);
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [engine, run]);

  // Push: register once per signed-in user; a received push triggers a sync, a tapped one opens its screen.
  useEffect(() => {
    if (!userId || authStatus !== 'signed-in') return;
    let cancelled = false;
    void registerForPush().then((r) => {
      if (!cancelled) setPush(r);
    });
    const received = Notifications.addNotificationReceivedListener(() => void run(true));
    const tapped = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as PushData;
      void run(true);
      const target = notificationTarget({ entity_type: data.entity_type ?? null, entity_id: data.entity_id ?? null });
      if (target) router.push(target);
    });
    return () => {
      cancelled = true;
      received.remove();
      tapped.remove();
    };
  }, [userId, authStatus, run, router]);

  const changed = useCallback(() => {
    setRevision((r) => r + 1);
    void refreshStatus();
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void run(false), WRITE_DEBOUNCE_MS);
  }, [refreshStatus, run]);

  const syncNow = useCallback(() => run(true), [run]);

  const value = useMemo(
    () => ({ store, storeError, revision, status, push, syncNow, changed, deleteFiles }),
    [store, storeError, revision, status, push, syncNow, changed],
  );
  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}

export function useOffline(): OfflineContextValue {
  const ctx = useContext(OfflineContext);
  if (!ctx) throw new Error('useOffline must be used inside <OfflineProvider>');
  return ctx;
}

/**
 * Reads from the local store and re-reads whenever local data changes
 * (after a sync or an edit). `key` identifies the inputs.
 */
export function useLocalQuery<T>(read: (store: LocalStore) => Promise<T>, key: string) {
  const { store, revision } = useOffline();
  const [state, setState] = useState<{ data?: T; error: string | null; loading: boolean }>({ error: null, loading: true });
  const readRef = useRef(read);
  useEffect(() => {
    readRef.current = read;
  });
  useEffect(() => {
    if (!store) return;
    let cancelled = false;
    readRef.current(store).then(
      (data) => {
        if (!cancelled) setState({ data, error: null, loading: false });
      },
      (e: unknown) => {
        if (!cancelled) setState((s) => ({ ...s, error: e instanceof Error ? e.message : String(e), loading: false }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [store, revision, key]);
  return state;
}
