import type { PrismaClient } from '@prisma/client';
import type { ReconciliationDomain, ReconciliationRow } from '../../../domain/v1/models/reconciliation';
import type { ReconciliationRepository, ReconciliationRowQuery } from '../../../domain/v1/ports/reconciliation-repository';
import { ReconciliationRowQuerySchema } from './schemas';

const SAMPLE_SIZE = 5;
const ALL_DOMAINS: readonly ReconciliationDomain[] = ['cvm-facts', 'market-bars', 'stock-monitoring'];

/** Intersection-based label matching: `matchedSamples` counts labels present on both sides among the drawn samples; the remainder (up to the larger sample) is `mismatchSamples`. Never mutates either input. */
function matchByLabel(legacyLabels: readonly string[], newLabels: readonly string[]): { matched: number; mismatch: number } {
  const legacySet = new Set(legacyLabels);
  const newSet = new Set(newLabels);
  let matched = 0;
  for (const label of legacySet) {
    if (newSet.has(label)) matched += 1;
  }
  const totalSamples = Math.max(legacyLabels.length, newLabels.length);
  return { matched, mismatch: Math.max(totalSamples - matched, 0) };
}

/**
 * Prisma implementation of ReconciliationRepository (Fase 2 / Item 6).
 * Read-only: queries the existing Prisma client against both the new
 * point-in-time foundation and the legacy tables — never writes,
 * migrates, or alters legacy data. No update/delete/upsert method
 * exists on this class.
 *
 * Identity/matching design decision: there is no shared primary key
 * between legacy and new-foundation rows, so samples are matched by a
 * canonical composite label built from business identity fields
 * (symbol/timeframe/date for market-bars; the same underlying
 * StockMonitoring row for stock-monitoring). `subjectId` is interpreted
 * per domain: InstrumentVersion/HistoricalCandle `symbol` for
 * market-bars, `Issuer.id` for cvm-facts, `Asset.id` for
 * stock-monitoring.
 */
export class PrismaReconciliationRepository implements ReconciliationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async computeRows(query: ReconciliationRowQuery): Promise<readonly ReconciliationRow[]> {
    const normalized = ReconciliationRowQuerySchema.parse(query);
    const domains = normalized.domain ? [normalized.domain] : ALL_DOMAINS;

    const rows: ReconciliationRow[] = [];
    for (const domain of domains) {
      rows.push(await this.computeDomainRow(domain, normalized));
    }

    const sorted = [...rows].sort((a, b) => a.domain.localeCompare(b.domain));
    const offset = normalized.offset ?? 0;
    const limit = normalized.limit ?? sorted.length;
    return Object.freeze(sorted.slice(offset, offset + limit));
  }

  private async computeDomainRow(
    domain: ReconciliationDomain,
    query: ReconciliationRowQuery & { decisionTime: string; knowledgeTime: string },
  ): Promise<ReconciliationRow> {
    switch (domain) {
      case 'market-bars':
        return this.computeMarketBarsRow(query);
      case 'cvm-facts':
        return this.computeCvmFactsRow(query);
      case 'stock-monitoring':
        return this.computeStockMonitoringRow(query);
      default: {
        const exhaustive: never = domain;
        throw new Error(`domínio de reconciliação desconhecido: ${String(exhaustive)}`);
      }
    }
  }

  private async computeMarketBarsRow(query: {
    decisionTime: string;
    knowledgeTime: string;
    subjectId?: string;
    from?: string;
    to?: string;
  }): Promise<ReconciliationRow> {
    const decisionDate = new Date(query.decisionTime);
    const knowledgeDate = new Date(query.knowledgeTime);
    const lowerBound = query.from ? new Date(query.from) : undefined;
    const upperBound = query.to ? new Date(query.to) : decisionDate;
    const symbol = query.subjectId;

    const legacyTimeFilter = lowerBound ? { gte: lowerBound, lte: upperBound } : { lte: upperBound };

    const [historicalCandleCount, marketDataCount] = await Promise.all([
      this.prisma.historicalCandle.count({
        where: { time: legacyTimeFilter, ...(symbol ? { symbol } : {}) },
      }),
      this.prisma.marketData.count({
        where: { timestamp: legacyTimeFilter, ...(symbol ? { asset: { symbol } } : {}) },
      }),
    ]);
    const legacyCount = historicalCandleCount + marketDataCount;

    const newCount = await this.prisma.versionedMarketBar.count({
      where: {
        openedAt: legacyTimeFilter,
        sourceAvailableAt: { lte: knowledgeDate },
        ...(symbol ? { instrumentVersion: { symbol } } : {}),
      },
    });

    const legacySamples = await this.prisma.historicalCandle.findMany({
      where: { time: legacyTimeFilter, ...(symbol ? { symbol } : {}) },
      orderBy: [{ time: 'desc' }, { id: 'desc' }],
      take: SAMPLE_SIZE,
      select: { id: true, symbol: true, timeframe: true, time: true },
    });
    const newSamples = await this.prisma.versionedMarketBar.findMany({
      where: {
        openedAt: legacyTimeFilter,
        sourceAvailableAt: { lte: knowledgeDate },
        ...(symbol ? { instrumentVersion: { symbol } } : {}),
      },
      orderBy: [{ openedAt: 'desc' }, { id: 'desc' }],
      take: SAMPLE_SIZE,
      select: { id: true, timeframe: true, openedAt: true, instrumentVersion: { select: { symbol: true } } },
    });

    const legacyLabels = legacySamples.map((row) => `${row.symbol}|${row.timeframe}|${row.time.toISOString().slice(0, 10)}`);
    const newLabels = newSamples.map(
      (row) => `${row.instrumentVersion.symbol}|${row.timeframe}|${row.openedAt.toISOString().slice(0, 10)}`,
    );
    const { matched, mismatch } = matchByLabel(legacyLabels, newLabels);

    return Object.freeze({
      domain: 'market-bars' as const,
      legacySource: 'HistoricalCandle+MarketData',
      newSource: 'VersionedMarketBar',
      legacyCount,
      newCount,
      sampleLegacyIds: Object.freeze(legacySamples.map((row) => String(row.id))),
      sampleNewIds: Object.freeze(newSamples.map((row) => row.id)),
      matchedSamples: matched,
      mismatchSamples: mismatch,
      decidedAt: new Date().toISOString(),
      knowledgeTime: query.knowledgeTime,
      decisionTime: query.decisionTime,
      provenance: { runId: `reconciliation:market-bars:${query.decisionTime}:${query.knowledgeTime}`, sourceKey: 'reconciliation:v1:on-demand' },
    });
  }

  private async computeCvmFactsRow(query: {
    decisionTime: string;
    knowledgeTime: string;
    subjectId?: string;
  }): Promise<ReconciliationRow> {
    // No legacy structured source exists for CVM facts (Items 1-5 are the
    // first structured, point-in-time representation): legacyCount is
    // always 0 and there is nothing to sample/match against, so this
    // domain is vacuously without mismatch (0/0), never a false positive.
    const knowledgeDate = new Date(query.knowledgeTime);
    const issuerId = query.subjectId;

    const pointInTimeFilter = {
      ...(issuerId ? { issuerId } : {}),
      createdByRun: { completedAt: { lte: knowledgeDate } },
    };

    const [factCount, shareCapitalCount] = await Promise.all([
      this.prisma.cvmFact.count({ where: pointInTimeFilter }),
      this.prisma.shareCapitalFact.count({ where: pointInTimeFilter }),
    ]);
    const newCount = factCount + shareCapitalCount;

    const newSamples = await this.prisma.cvmFact.findMany({
      where: pointInTimeFilter,
      orderBy: [{ id: 'asc' }],
      take: SAMPLE_SIZE,
      select: { id: true },
    });

    return Object.freeze({
      domain: 'cvm-facts' as const,
      legacySource: 'NONE (sem fundação legada estruturada para fatos CVM)',
      newSource: 'CvmFact+ShareCapitalFact',
      legacyCount: 0,
      newCount,
      sampleLegacyIds: Object.freeze([] as string[]),
      sampleNewIds: Object.freeze(newSamples.map((row) => row.id)),
      matchedSamples: 0,
      mismatchSamples: 0,
      decidedAt: new Date().toISOString(),
      knowledgeTime: query.knowledgeTime,
      decisionTime: query.decisionTime,
      provenance: { runId: `reconciliation:cvm-facts:${query.decisionTime}:${query.knowledgeTime}`, sourceKey: 'reconciliation:v1:on-demand' },
    });
  }

  private async computeStockMonitoringRow(query: {
    decisionTime: string;
    knowledgeTime: string;
    subjectId?: string;
  }): Promise<ReconciliationRow> {
    // StockMonitoring has no dedicated new-foundation replacement yet
    // (out of scope for Items 1-5): both sides read the same legacy
    // table, so this domain is a self-consistency visibility check, not
    // a genuine cross-source comparison. It is trivially without
    // mismatch by construction.
    const assetId = query.subjectId;
    const where = assetId ? { assetId } : {};

    const count = await this.prisma.stockMonitoring.count({ where });
    const samples = await this.prisma.stockMonitoring.findMany({
      where,
      orderBy: [{ id: 'asc' }],
      take: SAMPLE_SIZE,
      select: { id: true },
    });
    const ids = Object.freeze(samples.map((row) => row.id));

    return Object.freeze({
      domain: 'stock-monitoring' as const,
      legacySource: 'StockMonitoring',
      newSource: 'StockMonitoring (mesma fonte; sem fundação nova dedicada neste item)',
      legacyCount: count,
      newCount: count,
      sampleLegacyIds: ids,
      sampleNewIds: ids,
      matchedSamples: ids.length,
      mismatchSamples: 0,
      decidedAt: new Date().toISOString(),
      knowledgeTime: query.knowledgeTime,
      decisionTime: query.decisionTime,
      provenance: { runId: `reconciliation:stock-monitoring:${query.decisionTime}:${query.knowledgeTime}`, sourceKey: 'reconciliation:v1:on-demand' },
    });
  }
}
