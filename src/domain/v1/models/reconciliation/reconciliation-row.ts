/**
 * Fase 2 / Item 6 — Reconciliação e paridade com legado (somente leitura).
 * `ReconciliationRow` is the per-domain comparison result between a
 * legacy source (HistoricalCandle/MarketData/StockMonitoring) and the
 * new point-in-time foundation (VersionedMarketBar, CvmFact +
 * ShareCapitalFact). Purely a measurement/decision-support shape — never
 * used to trigger a cutover automatically.
 *
 * `legacyCount`/`newCount` are plain row counts: exact, non-negative
 * integers returned by `Prisma.count()`, never a float/decimal. They are
 * typed `number` here (not `bigint`) because a row count is not a
 * financial magnitude in the sense the project's BigInt-exactness rule
 * targets (prices/quantities); it is always a safe integer.
 */

export type ReconciliationDomain = 'cvm-facts' | 'market-bars' | 'stock-monitoring';

export interface ReconciliationProvenance {
  readonly runId: string;
  readonly sourceKey: string;
}

export interface ReconciliationRow {
  readonly domain: ReconciliationDomain;
  readonly legacySource: string;
  readonly newSource: string;
  readonly legacyCount: number;
  readonly newCount: number;
  readonly sampleLegacyIds: readonly string[];
  readonly sampleNewIds: readonly string[];
  /** Amostras cujo identificador canônico/rótulo temporário coincide. */
  readonly matchedSamples: number;
  /** Amostras divergentes ou não mapeáveis. */
  readonly mismatchSamples: number;
  readonly decidedAt: string;
  readonly knowledgeTime: string;
  readonly decisionTime: string;
  readonly provenance: ReconciliationProvenance;
}
