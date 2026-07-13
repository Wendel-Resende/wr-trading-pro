import type { InstrumentVersionId } from '../models/instrument-version';
import type { Timeframe } from '../models/market-bar';
import type { MarketBarPointInTimeView, VersionedMarketBar } from '../models/versioned-market-bar';

/**
 * Read boundary for versioned market bars (Fase 2 / Item 3).
 *
 * `sourceKey` is a required, explicit parameter on every query — there is
 * never an implicit merge across multiple sources for the same
 * instrument/timeframe/openedAt.
 *
 * For each distinct `openedAt` in range, the repository selects the
 * highest `revisionNumber` visible under `view` before any further
 * projection/filtering: a future (not-yet-visible) revision never
 * suppresses its still-visible predecessor.
 */
export interface MarketBarRepository {
  findBars(
    instrumentVersionId: InstrumentVersionId,
    sourceKey: string,
    timeframe: Timeframe,
    from: string,
    to: string,
    view: MarketBarPointInTimeView,
  ): Promise<readonly VersionedMarketBar[]>;
}
