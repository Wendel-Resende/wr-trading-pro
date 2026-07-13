import type { ReconciliationDomain, ReconciliationRow } from '../models/reconciliation';

export interface ReconciliationRowQuery {
  readonly decisionTime: string;
  readonly knowledgeTime: string;
  readonly domain?: ReconciliationDomain;
  readonly subjectId?: string;
  /** Optional lower bound narrowing the window used for legacy/new sample selection (defaults to an open lower bound). */
  readonly from?: string;
  /** Optional upper bound narrowing the window (defaults to `decisionTime`). */
  readonly to?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Read-only comparison/counting port between the new point-in-time
 * foundation (VersionedMarketBar, CvmFact/ShareCapitalFact) and the
 * legacy tables/services (HistoricalCandle, MarketData,
 * StockMonitoring). Never migrates or mutates legacy data — every
 * implementation reads through the existing Prisma client only. No
 * update/delete/upsert method exists on this port.
 */
export interface ReconciliationRepository {
  computeRows(query: ReconciliationRowQuery): Promise<readonly ReconciliationRow[]>;
}
