import { canonicalizeB3Ticker } from '@/lib/b3-ticker';

/** Estado mínimo, local e somente de navegação da área de trabalho. */
export interface WorkspaceInstrumentState {
  activeSymbol: string;
  favorites: string[];
}

export const DEFAULT_ACTIVE_INSTRUMENT = 'PETR4';

export const DEFAULT_WORKSPACE_INSTRUMENT_STATE: WorkspaceInstrumentState = Object.freeze({
  activeSymbol: DEFAULT_ACTIVE_INSTRUMENT,
  favorites: [],
});

/** Retorna somente tickers B3 canônicos; valores externos nunca viram estado. */
export function normalizeWorkspaceInstrument(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const symbol = canonicalizeB3Ticker(raw);
  return symbol === 'DESCONHECIDO' ? null : symbol;
}

export function addFavorite(favorites: readonly string[], raw: unknown): string[] {
  const symbol = normalizeWorkspaceInstrument(raw);
  if (!symbol) return [...favorites];
  const normalized = favorites
    .map(normalizeWorkspaceInstrument)
    .filter((value): value is string => value !== null);
  return [symbol, ...normalized.filter((favorite) => favorite !== symbol)];
}

export function removeFavorite(favorites: readonly string[], raw: unknown): string[] {
  const symbol = normalizeWorkspaceInstrument(raw);
  if (!symbol) return [...favorites];
  return favorites.filter((favorite) => favorite !== symbol);
}

export function serializeWorkspaceInstrument(state: WorkspaceInstrumentState): string {
  return JSON.stringify({
    activeSymbol: normalizeWorkspaceInstrument(state.activeSymbol) ?? DEFAULT_ACTIVE_INSTRUMENT,
    favorites: state.favorites
      .map(normalizeWorkspaceInstrument)
      .filter((value): value is string => value !== null)
      .filter((value, index, items) => items.indexOf(value) === index),
  });
}

/** Storage local é entrada não confiável: JSON ou campos inválidos voltam ao fallback seguro. */
export function deserializeWorkspaceInstrument(raw: string | null): WorkspaceInstrumentState {
  if (!raw) return { ...DEFAULT_WORKSPACE_INSTRUMENT_STATE };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_WORKSPACE_INSTRUMENT_STATE };
    const candidate = parsed as { activeSymbol?: unknown; favorites?: unknown };
    const activeSymbol = normalizeWorkspaceInstrument(candidate.activeSymbol) ?? DEFAULT_ACTIVE_INSTRUMENT;
    const favorites = Array.isArray(candidate.favorites)
      ? candidate.favorites
        .map(normalizeWorkspaceInstrument)
        .filter((value): value is string => value !== null)
        .filter((value, index, items) => items.indexOf(value) === index)
      : [];
    return { activeSymbol, favorites };
  } catch {
    return { ...DEFAULT_WORKSPACE_INSTRUMENT_STATE };
  }
}
