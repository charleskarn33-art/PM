import { createContext, useContext, type ReactNode } from 'react';
import { usePmVisit, type PmVisitModel } from './use-pm-visit';

const PmVisitContext = createContext<PmVisitModel | null>(null);

/** One shared model per open visit, so all PM screens see the same answers. */
export function PmVisitProvider({ visitId, children }: { visitId: string; children: ReactNode }) {
  const model = usePmVisit(visitId);
  return <PmVisitContext.Provider value={model}>{children}</PmVisitContext.Provider>;
}

export function usePmVisitContext(): PmVisitModel {
  const ctx = useContext(PmVisitContext);
  if (!ctx) throw new Error('usePmVisitContext must be used inside <PmVisitProvider>');
  return ctx;
}
