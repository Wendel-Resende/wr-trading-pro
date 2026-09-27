"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  addFavorite,
  DEFAULT_WORKSPACE_INSTRUMENT_STATE,
  deserializeWorkspaceInstrument,
  normalizeWorkspaceInstrument,
  removeFavorite,
  serializeWorkspaceInstrument,
  type WorkspaceInstrumentState,
} from '@/lib/workspace/instrument-state';

const STORAGE_KEY = 'wr.workspace.instrument.v1';

interface InstrumentContextValue extends WorkspaceInstrumentState {
  hydrated: boolean;
  setActiveSymbol: (symbol: string) => boolean;
  toggleFavorite: (symbol?: string) => void;
}

const InstrumentContext = createContext<InstrumentContextValue | null>(null);

export function InstrumentProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WorkspaceInstrumentState>({ ...DEFAULT_WORKSPACE_INSTRUMENT_STATE });
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      setState(deserializeWorkspaceInstrument(window.localStorage.getItem(STORAGE_KEY)));
    } catch {
      setState({ ...DEFAULT_WORKSPACE_INSTRUMENT_STATE });
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, serializeWorkspaceInstrument(state));
    } catch {
      // A plataforma permanece navegável quando o storage do renderer não existe.
    }
  }, [hydrated, state]);

  const setActiveSymbol = useCallback((raw: string): boolean => {
    const symbol = normalizeWorkspaceInstrument(raw);
    if (!symbol) return false;
    setState((previous) => ({ ...previous, activeSymbol: symbol }));
    return true;
  }, []);

  const toggleFavorite = useCallback((raw?: string) => {
    setState((previous) => {
      const symbol = normalizeWorkspaceInstrument(raw ?? previous.activeSymbol);
      if (!symbol) return previous;
      return previous.favorites.includes(symbol)
        ? { ...previous, favorites: removeFavorite(previous.favorites, symbol) }
        : { ...previous, favorites: addFavorite(previous.favorites, symbol) };
    });
  }, []);

  const value = useMemo(() => ({ ...state, hydrated, setActiveSymbol, toggleFavorite }), [state, hydrated, setActiveSymbol, toggleFavorite]);
  return <InstrumentContext.Provider value={value}>{children}</InstrumentContext.Provider>;
}

export function useInstrumentContext(): InstrumentContextValue {
  const context = useContext(InstrumentContext);
  if (!context) throw new Error('useInstrumentContext deve ser usado dentro de InstrumentProvider');
  return context;
}
