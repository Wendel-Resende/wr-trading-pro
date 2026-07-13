import type { IngestionRunId } from './ingestion';
import type { InstrumentVersionId } from './instrument-version';
import type { Timeframe } from './market-bar';

/**
 * Persisted, versioned, point-in-time market bar (Fase 2 / Item 3).
 *
 * Distinct from `MarketBar`/`HistoricalBarsRequest` (src/domain/v1/models/market-bar.ts),
 * which remain unchanged and are used by the existing client-side
 * bar-fetching path. `VersionedMarketBar` is the persisted, append-only,
 * source-scoped, revisioned counterpart used by the new governed
 * ingestion foundation — it is never read or written by the legacy path.
 *
 * Exact values: real price = rawValue * 10^priceScalePow; real volume =
 * volumeRaw * 10^volumeScalePow. All raw integers are signed 64-bit
 * (BigInt), never floats.
 *
 * `sourceKey` is never part of the submission — it is always derived
 * from the current IngestionRun that is committing the batch, so a
 * single unit-of-work commit can never silently mix data from more than
 * one source.
 *
 * Revision chain: a root bar has `revisionNumber = 1` and
 * `supersedesBarId = null`. A revision has `supersedesBarId` pointing at
 * its predecessor (same instrumentVersionId/timeframe/sourceKey/openedAt)
 * and `revisionNumber = predecessor.revisionNumber + 1`.
 */

export type VersionedMarketBarId = string;

export type VolumeSemantics = 'TICKS' | 'CONTRACTS' | 'SHARES' | 'NOTIONAL';

export type PriceBasis = 'TRADE' | 'MID' | 'BID' | 'ASK';

export type MarketBarQuality = 'FINAL' | 'PROVISIONAL' | 'ESTIMATED' | 'CORRECTED';

export interface VersionedMarketBar {
  readonly id: VersionedMarketBarId;
  readonly instrumentVersionId: InstrumentVersionId;
  /** Derived from the creating IngestionRun; never chosen by the persistence layer itself. */
  readonly sourceKey: string;
  /** Normalized source-native identity of the observation, unique within sourceKey. */
  readonly sourceRecordKey: string;
  readonly timeframe: Timeframe;
  /** Bar open instant, ISO-8601, inclusive. */
  readonly openedAt: string;
  /** Bar close instant, ISO-8601, exclusive of the next bar; explicit, never derived from timeframe. */
  readonly closedAt: string;
  /** Instant at which this observation/revision became available from the source. */
  readonly sourceAvailableAt: string;
  readonly openRaw: bigint;
  readonly highRaw: bigint;
  readonly lowRaw: bigint;
  readonly closeRaw: bigint;
  /** Decimal exponent shared by all four OHLC raw values: real price = raw * 10^priceScalePow. */
  readonly priceScalePow: number;
  readonly volumeRaw: bigint;
  readonly volumeScalePow: number;
  readonly volumeSemantics: VolumeSemantics;
  readonly tradeCount: bigint | null;
  readonly priceBasis: PriceBasis;
  readonly quality: MarketBarQuality;
  /** 64 lowercase hex chars over the raw source payload. */
  readonly rawSha256: string;
  readonly revisionNumber: number;
  readonly supersedesBarId: VersionedMarketBarId | null;
  readonly createdByRunId: IngestionRunId;
}

/**
 * Batch submission DTO. Deliberately excludes `sourceKey` (derived from
 * the current run) and `id`/`revisionNumber` (computed by the unit of
 * work from the revision chain).
 */
export interface VersionedMarketBarSubmission {
  readonly instrumentVersionId: InstrumentVersionId;
  readonly sourceRecordKey: string;
  readonly timeframe: Timeframe;
  readonly openedAt: string;
  readonly closedAt: string;
  readonly sourceAvailableAt: string;
  readonly openRaw: bigint;
  readonly highRaw: bigint;
  readonly lowRaw: bigint;
  readonly closeRaw: bigint;
  readonly priceScalePow: number;
  readonly volumeRaw: bigint;
  readonly volumeScalePow: number;
  readonly volumeSemantics: VolumeSemantics;
  readonly tradeCount?: bigint | null;
  readonly priceBasis: PriceBasis;
  readonly quality: MarketBarQuality;
  readonly rawSha256: string;
  readonly isRevision: boolean;
  /** Required when isRevision=true; must be absent/null when isRevision=false. */
  readonly supersedesSourceRecordKey?: string | null;
}

/**
 * Point-in-time read view, same two-axis contract as `CvmPointInTimeView`:
 *  - `decisionTime`: market-availability instant being simulated — a bar
 *    is only visible when `closedAt <= decisionTime` AND
 *    `sourceAvailableAt <= decisionTime`.
 *  - `knowledgeTime`: platform system-time axis — a bar is only visible
 *    when its `createdByRun` reached SUCCEEDED with
 *    `completedAt <= knowledgeTime`.
 *
 * Implementations MUST reject `knowledgeTime > decisionTime`.
 */
export interface MarketBarPointInTimeView {
  readonly decisionTime: string;
  readonly knowledgeTime: string;
}
