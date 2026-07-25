/**
 * Fonte única do padrão de ticker B3. Raiz de 1 letra + 3 alfanuméricos
 * maiúsculos + 1-2 dígitos de tipo — aceita `B3SA3` (raiz com dígito, a
 * própria B3 S.A.), rejeita número puro e é path-safe (sem `/`, `.`, `..`,
 * separadores). A cópia Python vive em `python/ml_api.py::_TICKER_RE` e DEVE
 * ser mantida idêntica (testes de aceitação/rejeição em ambos os lados).
 */
export const B3_TICKER_PATTERN = '[A-Z][A-Z0-9]{3}\\d{1,2}';

export const B3_TICKER_EXACT = new RegExp(`^${B3_TICKER_PATTERN}$`);

/** Regex global é stateful (lastIndex) — nova instância a cada chamada. */
export const b3TickerGlobal = (): RegExp => new RegExp(`\\b${B3_TICKER_PATTERN}\\b`, 'g');

export const isB3Ticker = (raw: string): boolean =>
  typeof raw === 'string' && B3_TICKER_EXACT.test(raw);

/** Uppercase+trim; devolve o ticker canônico ou `'DESCONHECIDO'`. */
export const canonicalizeB3Ticker = (raw: string): string => {
  const u = (typeof raw === 'string' ? raw : '').trim().toUpperCase();
  return B3_TICKER_EXACT.test(u) ? u : 'DESCONHECIDO';
};
