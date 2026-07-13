import type { PrismaClient } from '@prisma/client';
import type { Timeframe } from '../../../domain/v1/models/market-bar';
import type { MarketBarPointInTimeView, VersionedMarketBar } from '../../../domain/v1/models/versioned-market-bar';
import type { MarketBarRepository } from '../../../domain/v1/ports/market-bar-repository';
import { toVersionedMarketBar } from './mapping';
import {
  InstrumentVersionIdSchema,
  MarketBarPointInTimeViewSchema,
  MarketBarRangeSchema,
  SourceKeySchema,
  TimeframeSchema,
} from './schemas';

/**
 * Prisma implementation of MarketBarRepository. A row is visible only
 * when `closedAt <= decisionTime` AND `sourceAvailableAt <= decisionTime`
 * AND its `createdByRun` is SUCCEEDED with `completedAt <= knowledgeTime`.
 * For each distinct `openedAt`, only the highest visible `revisionNumber`
 * is returned — a future revision never suppresses its still-visible
 * predecessor.
 */
export class PrismaMarketBarRepository implements MarketBarRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findBars(
    instrumentVersionId: string,
    sourceKey: string,
    timeframe: Timeframe,
    from: string,
    to: string,
    view: MarketBarPointInTimeView,
  ): Promise<readonly VersionedMarketBar[]> {
    const normalizedInstrumentVersionId = InstrumentVersionIdSchema.parse(instrumentVersionId);
    const normalizedSourceKey = SourceKeySchema.parse(sourceKey);
    const normalizedTimeframe = TimeframeSchema.parse(timeframe);
    const normalizedRange = MarketBarRangeSchema.parse({ from, to });
    const normalizedView = MarketBarPointInTimeViewSchema.parse(view);

    const rows = await this.prisma.versionedMarketBar.findMany({
      where: {
        instrumentVersionId: normalizedInstrumentVersionId,
        sourceKey: normalizedSourceKey,
        timeframe: normalizedTimeframe,
        openedAt: { gte: new Date(normalizedRange.from), lt: new Date(normalizedRange.to) },
        closedAt: { lte: new Date(normalizedView.decisionTime) },
        sourceAvailableAt: { lte: new Date(normalizedView.decisionTime) },
        createdByRun: { is: { status: 'SUCCEEDED', completedAt: { lte: new Date(normalizedView.knowledgeTime) } } },
      },
      orderBy: [{ openedAt: 'asc' }, { revisionNumber: 'asc' }],
    });

    const bestByOpenedAt = new Map<number, (typeof rows)[number]>();
    for (const row of rows) {
      const key = row.openedAt.valueOf();
      const current = bestByOpenedAt.get(key);
      if (!current || row.revisionNumber > current.revisionNumber) {
        bestByOpenedAt.set(key, row);
      }
    }

    const effective = [...bestByOpenedAt.values()].sort((a, b) => a.openedAt.valueOf() - b.openedAt.valueOf());
    return Object.freeze(effective.map(toVersionedMarketBar));
  }
}
