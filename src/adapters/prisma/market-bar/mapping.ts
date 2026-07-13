import type { VersionedMarketBar as VersionedMarketBarRow } from '@prisma/client';
import type { Timeframe } from '../../../domain/v1/models/market-bar';
import type {
  MarketBarQuality,
  PriceBasis,
  VersionedMarketBar,
  VolumeSemantics,
} from '../../../domain/v1/models/versioned-market-bar';

export const toVersionedMarketBar = (row: VersionedMarketBarRow): VersionedMarketBar => ({
  id: row.id,
  instrumentVersionId: row.instrumentVersionId,
  sourceKey: row.sourceKey,
  sourceRecordKey: row.sourceRecordKey,
  timeframe: row.timeframe as Timeframe,
  openedAt: row.openedAt.toISOString(),
  closedAt: row.closedAt.toISOString(),
  sourceAvailableAt: row.sourceAvailableAt.toISOString(),
  openRaw: row.openRaw,
  highRaw: row.highRaw,
  lowRaw: row.lowRaw,
  closeRaw: row.closeRaw,
  priceScalePow: row.priceScalePow,
  volumeRaw: row.volumeRaw,
  volumeScalePow: row.volumeScalePow,
  volumeSemantics: row.volumeSemantics as VolumeSemantics,
  tradeCount: row.tradeCount,
  priceBasis: row.priceBasis as PriceBasis,
  quality: row.quality as MarketBarQuality,
  rawSha256: row.rawSha256,
  revisionNumber: row.revisionNumber,
  supersedesBarId: row.supersedesBarId,
  createdByRunId: row.createdByRunId,
});
