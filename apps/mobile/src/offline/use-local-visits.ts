import { useEffect, useState } from 'react';
import { useOffline } from './offline-provider';
import type { VisitView } from './store';

/** The visits kept on this phone (open ones and ones with changes not yet sent), kept current. */
export function useLocalVisits(): VisitView[] {
  const { store } = useOffline();
  const [visits, setVisits] = useState<{ store: unknown; list: VisitView[] }>({ store: null, list: [] });

  useEffect(() => {
    if (!store) return;
    let live = true;
    const load = () =>
      void store
        .visits()
        .then((list) => live && setVisits({ store, list }))
        .catch(() => undefined);
    load();
    const unsubscribe = store.onChange(load);
    return () => {
      live = false;
      unsubscribe();
    };
  }, [store]);

  return visits.store === store ? visits.list : [];
}
