/**
 * Regras puras do ticker tape. A apresentação nunca deve repetir um ativo
 * somente para simular rolagem contínua.
 */
export function dedupeTickerSymbols(symbols: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of symbols) {
    const symbol = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    result.push(symbol);
  }
  return result;
}

/** Limite real da rolagem: fim do conteúdo único, nunca metade de uma cópia. */
export function getTickerScrollLimit(scrollWidth: number, containerWidth: number): number {
  if (!Number.isFinite(scrollWidth) || !Number.isFinite(containerWidth)) return 0;
  return Math.max(0, scrollWidth - containerWidth);
}
