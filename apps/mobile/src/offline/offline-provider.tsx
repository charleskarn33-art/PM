import * as Network from 'expo-network';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import type { FieldPack } from '@/lib/api/types';
import { errorMessage } from '@/lib/api/errors';
import { useAuth } from '@/providers/auth-provider';
import { openOffline } from './runtime';
import type { OfflineStore, OutboxCounts } from './store';
import type { SyncEngine } from './sync';

export interface OfflineContext {
  store: OfflineStore | null;
  engine: SyncEngine | null;
  counts: OutboxCounts;
  syncing: boolean;
  /** The phone reports a connection (null: not known yet). */
  online: boolean | null;
  lastSyncAt: string | null;
  /** Why the last attempt did not finish (no connection, server problem). */
  problem: string | null;
  /** The field pack saved on the phone (sites, schedules, checklists, settings). */
  pack: FieldPack | null;
  packSavedAt: string | null;
  /** Sends waiting changes and downloads fresh data now. */
  syncNow: () => Promise<void>;
  /** Sends waiting changes shortly (after a burst of edits). */
  requestSync: () => void;
}

const EMPTY: OutboxCounts = { pending: 0, syncing: 0, errors: 0 };
const PACK_MAX_AGE_MS = 5 * 60_000;
const DEBOUNCE_MS = 1_000;

const Ctx = createContext<OfflineContext | null>(null);

/**
 * Keeps the phone's offline store for the signed-in user and syncs it: on
 * start, when the connection returns, when the app comes to the front, after
 * edits, and when a postponed change is due for another try.
 */
export function OfflineProvider({ children }: { children: ReactNode }) {
  const { status, userId } = useAuth();
  const [pair, setPair] = useState<{ userId: string; store: OfflineStore; engine: SyncEngine } | null>(null);
  const [counts, setCounts] = useState<OutboxCounts>(EMPTY);
  const [syncing, setSyncing] = useState(false);
  const [online, setOnline] = useState<boolean | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pack, setPack] = useState<{ userId: string; data: FieldPack; savedAt: string } | null>(null);
  const packFetchedAt = useRef(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The sync to run when a postponed change is due (set below, after syncNow exists).
  const retry = useRef<() => void>(() => undefined);

  const active = status === 'signed-in' && userId ? pair?.userId === userId ? pair : null : null;

  // Open the store for the signed-in user.
  useEffect(() => {
    if (status !== 'signed-in' || !userId) return;
    let live = true;
    openOffline(userId)
      .then(async (opened) => {
        if (!live || !opened) return;
        setPair({ userId, ...opened });
        const saved = await opened.store.getCache<FieldPack>('pack');
        if (live && saved) setPack({ userId, ...saved });
      })
      .catch(() => live && setProblem('The phone’s offline storage could not be opened.'));
    return () => {
      live = false;
    };
  }, [status, userId]);

  const syncNow = useCallback(
    async (forcePack = true) => {
      if (!active) return;
      const { store, engine } = active;
      setSyncing(true);
      try {
        const r = await engine.sync();
        if (r.offline) {
          setProblem('No connection. Changes are kept on this phone and sent when you are back online.');
        } else {
          setProblem(null);
          if (forcePack || Date.now() - packFetchedAt.current > PACK_MAX_AGE_MS) {
            const data = await engine.refreshPack();
            packFetchedAt.current = Date.now();
            setPack({ userId: store.userId, data, savedAt: new Date().toISOString() });
          }
          setLastSyncAt(new Date().toISOString());
        }
      } catch (e) {
        setProblem(errorMessage(e, 'sync'));
      } finally {
        setSyncing(false);
        setCounts(await store.counts());
        // Wake up when the next postponed change is due.
        const next = await store.nextAttemptAt();
        if (retryTimer.current) clearTimeout(retryTimer.current);
        if (next != null) retryTimer.current = setTimeout(() => retry.current(), Math.max(1_000, next - Date.now()));
      }
    },
    [active],
  );

  useEffect(() => {
    retry.current = () => void syncNow(false);
  }, [syncNow]);

  const requestSync = useCallback(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void syncNow(false), DEBOUNCE_MS);
  }, [syncNow]);

  // Sync on start, when the app comes to the front and when the connection returns.
  useEffect(() => {
    if (!active) return;
    void Promise.resolve().then(() => syncNow(true));
    const unsubscribe = active.store.onChange(() => void active.store.counts().then(setCounts));
    const app = AppState.addEventListener('change', (s) => s === 'active' && void syncNow(false));
    const net = Network.addNetworkStateListener((s) => {
      const up = Boolean(s.isConnected && s.isInternetReachable !== false);
      setOnline(up);
      if (up) void syncNow(false);
    });
    void Network.getNetworkStateAsync().then((s) => setOnline(Boolean(s.isConnected && s.isInternetReachable !== false)));
    return () => {
      unsubscribe();
      app.remove();
      net.remove();
      if (debounce.current) clearTimeout(debounce.current);
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [active, syncNow]);

  const value: OfflineContext = {
    store: active?.store ?? null,
    engine: active?.engine ?? null,
    counts: active ? counts : EMPTY,
    syncing,
    online,
    lastSyncAt,
    problem,
    pack: active && pack?.userId === active.userId ? pack.data : null,
    packSavedAt: active && pack?.userId === active.userId ? pack.savedAt : null,
    syncNow: () => syncNow(true),
    requestSync,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOffline(): OfflineContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useOffline must be used inside <OfflineProvider>');
  return ctx;
}
