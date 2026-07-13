import { Prisma, type PrismaClient } from '@prisma/client';
import type { IngestionRunId, IngestionSourceKey } from '../../../domain/v1/models/ingestion';
import type {
  MarketBarIngestionBatch,
  MarketBarIngestionUnitOfWork,
} from '../../../domain/v1/ports/market-bar-ingestion-unit-of-work';
import { compareInstants } from '../../../domain/v1/time';
import {
  BarChainViolationError,
  BarConflictError,
  DuplicateSourceRecordError,
  InstrumentVersionNotKnownError,
  InvalidMarketBarInputError,
  OpenedAtOutOfKnownRangeError,
  PredecessorAlreadySupersededError,
  RunChronologyError,
  RunNotFoundError,
  RunNotRunningError,
  SourceSymbolRuleViolationError,
  UnknownInstrumentVersionReferenceError,
  UnknownPredecessorBarError,
} from './errors';
import { IngestionRunIdSchema, MarketBarIngestionBatchSchema, SourceKeySchema, SummarySchema } from './schemas';
import { requireAdapterInstant } from './timestamps';

const requireChronology = (runId: string, startedAt: Date, completedAt: string): void => {
  const startedAtInstant = requireAdapterInstant(startedAt.toISOString(), 'startedAt');
  const completedAtInstant = requireAdapterInstant(completedAt, 'completedAt');
  if (compareInstants(completedAtInstant, startedAtInstant) < 0) {
    throw new RunChronologyError(`completedAt é anterior a startedAt para run ${runId}: cronologia impossível`);
  }
};

const isUniqueViolationOn = (error: unknown, target: string): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError
  && error.code === 'P2002'
  && Array.isArray(error.meta?.target)
  && (error.meta.target as unknown[]).some((t) => String(t).includes(target));

interface ResolvedBar {
  readonly id: string;
  readonly instrumentVersionId: string;
  readonly sourceKey: string;
  readonly sourceRecordKey: string;
  readonly timeframe: string;
  readonly openedAt: Date;
  readonly closedAt: Date;
  readonly sourceAvailableAt: Date;
  readonly openRaw: bigint;
  readonly highRaw: bigint;
  readonly lowRaw: bigint;
  readonly closeRaw: bigint;
  readonly priceScalePow: number;
  readonly volumeRaw: bigint;
  readonly volumeScalePow: number;
  readonly volumeSemantics: string;
  readonly tradeCount: bigint | null;
  readonly priceBasis: string;
  readonly quality: string;
  readonly rawSha256: string;
  readonly revisionNumber: number;
  readonly supersedesBarId: string | null;
  readonly createdByRunId: string;
}

/**
 * Prisma implementation of MarketBarIngestionUnitOfWork. Holds the only
 * write path into VersionedMarketBar rows. This unit of work never
 * creates an InstrumentVersion — every instrumentVersionId referenced
 * must already exist and be known point-in-time.
 */
export class PrismaMarketBarIngestionUnitOfWork implements MarketBarIngestionUnitOfWork {
  constructor(private readonly prisma: PrismaClient) {}

  async begin(sourceKey: IngestionSourceKey, startedAt: string): Promise<IngestionRunId> {
    const normalizedSourceKey = SourceKeySchema.parse(sourceKey);
    requireAdapterInstant(startedAt, 'startedAt');
    const run = await this.prisma.ingestionRun.create({
      data: {
        sourceKey: normalizedSourceKey,
        status: 'RUNNING',
        startedAt: new Date(startedAt),
        completedAt: null,
        summary: null,
      },
    });
    return run.id;
  }

  async fail(runId: IngestionRunId, completedAt: string, summary: string): Promise<void> {
    const normalizedRunId = IngestionRunIdSchema.parse(runId);
    requireAdapterInstant(completedAt, 'completedAt');
    const normalizedSummary = SummarySchema.parse(summary);
    await this.prisma.$transaction(async (tx) => {
      const run = await tx.ingestionRun.findUnique({ where: { id: normalizedRunId } });
      if (!run) throw new RunNotFoundError(`run ${normalizedRunId} não encontrada`);
      if (run.status !== 'RUNNING') {
        throw new RunNotRunningError(`run ${normalizedRunId} não está RUNNING (status atual: ${run.status})`);
      }
      requireChronology(normalizedRunId, run.startedAt, completedAt);
      const transitioned = await tx.ingestionRun.updateMany({
        where: { id: normalizedRunId, status: 'RUNNING' },
        data: { status: 'FAILED', completedAt: new Date(completedAt), summary: normalizedSummary },
      });
      if (transitioned.count !== 1) {
        throw new RunNotRunningError(`run ${normalizedRunId} perdeu a transição RUNNING → FAILED`);
      }
    });
  }

  async commit(
    runId: IngestionRunId,
    completedAt: string,
    summary: string,
    batch: MarketBarIngestionBatch,
  ): Promise<void> {
    const normalizedRunId = IngestionRunIdSchema.parse(runId);
    const completedAtInstant = requireAdapterInstant(completedAt, 'completedAt');
    const normalizedSummary = SummarySchema.parse(summary);
    const parsed = MarketBarIngestionBatchSchema.parse(batch);

    await this.prisma.$transaction(async (tx) => {
      const run = await tx.ingestionRun.findUnique({ where: { id: normalizedRunId } });
      if (!run) throw new RunNotFoundError(`run ${normalizedRunId} não encontrada`);
      if (run.status !== 'RUNNING') {
        throw new RunNotRunningError(`run ${runId} não está RUNNING (status atual: ${run.status})`);
      }
      requireChronology(normalizedRunId, run.startedAt, completedAt);

      // sourceKey is ALWAYS derived from the current run — never from the
      // submission itself — so a single commit can never silently mix
      // more than one source.
      const sourceKey = SourceKeySchema.parse(run.sourceKey);

      const instrumentVersionCache = new Map<
        string,
        { id: string; symbol: string; validFrom: Date; validTo: Date | null }
      >();

      const resolveInstrumentVersion = async (
        instrumentVersionId: string,
      ): Promise<{ id: string; symbol: string; validFrom: Date; validTo: Date | null }> => {
        const cached = instrumentVersionCache.get(instrumentVersionId);
        if (cached) return cached;

        const row = await tx.instrumentVersion.findUnique({
          where: { id: instrumentVersionId },
          include: { createdByRun: true, closedByRun: true },
        });
        if (!row) {
          throw new UnknownInstrumentVersionReferenceError(
            `instrumentVersionId=${instrumentVersionId} não existe; a unit of work de barras nunca cria InstrumentVersion`,
          );
        }
        // Point-in-time gate: the InstrumentVersion itself must be known
        // (its creating run SUCCEEDED and completed) at or before this
        // run's completedAt.
        if (
          row.createdByRun.status !== 'SUCCEEDED'
          || row.createdByRun.completedAt === null
          || compareInstants(
            requireAdapterInstant(row.createdByRun.completedAt.toISOString(), 'createdByRun.completedAt'),
            completedAtInstant,
          ) > 0
        ) {
          throw new InstrumentVersionNotKnownError(
            `instrumentVersionId=${instrumentVersionId} ainda não é conhecida (point-in-time) no completedAt desta run`,
          );
        }
        // validTo is only honored (closing surfaced) when the closing run
        // itself is SUCCEEDED and completed at or before this run's
        // completedAt; otherwise the interval is treated as still open.
        const closeVisible =
          row.closedByRun !== null
          && row.closedByRun.status === 'SUCCEEDED'
          && row.closedByRun.completedAt !== null
          && compareInstants(
            requireAdapterInstant(row.closedByRun.completedAt.toISOString(), 'closedByRun.completedAt'),
            completedAtInstant,
          ) <= 0;

        const resolved = {
          id: row.id,
          symbol: row.symbol,
          validFrom: row.validFrom,
          validTo: closeVisible ? row.validTo : null,
        };
        instrumentVersionCache.set(instrumentVersionId, resolved);
        return resolved;
      };

      // Resolve instrument versions and validate the SQX naming rule +
      // business-time window for every submission up front.
      const barsWithContext = await Promise.all(
        parsed.bars.map(async (submission) => {
          const openedAtInstant = requireAdapterInstant(submission.openedAt, 'openedAt');
          const closedAtInstant = requireAdapterInstant(submission.closedAt, 'closedAt');
          const sourceAvailableAtInstant = requireAdapterInstant(submission.sourceAvailableAt, 'sourceAvailableAt');

          if (compareInstants(closedAtInstant, sourceAvailableAtInstant) > 0) {
            throw new InvalidMarketBarInputError(
              `bar ${submission.sourceRecordKey}: closedAt deve ser <= sourceAvailableAt`,
              ['closedAt', 'sourceAvailableAt'],
            );
          }
          if (compareInstants(sourceAvailableAtInstant, completedAtInstant) > 0) {
            throw new InvalidMarketBarInputError(
              `bar ${submission.sourceRecordKey}: sourceAvailableAt não pode ser posterior ao completedAt da ingestão`,
              ['sourceAvailableAt', 'completedAt'],
            );
          }

          const instrumentVersion = await resolveInstrumentVersion(submission.instrumentVersionId);

          if (sourceKey.startsWith('sqx')) {
            const symbol = instrumentVersion.symbol.toUpperCase();
            if (!symbol.startsWith('WIN') && !symbol.startsWith('WDO')) {
              throw new SourceSymbolRuleViolationError(
                `sourceKey=${sourceKey} (sqx) exige InstrumentVersion.symbol iniciando com WIN ou WDO; symbol=${instrumentVersion.symbol}`,
              );
            }
          }

          if (compareInstants(openedAtInstant, requireAdapterInstant(instrumentVersion.validFrom.toISOString(), 'validFrom')) < 0) {
            throw new OpenedAtOutOfKnownRangeError(
              `bar ${submission.sourceRecordKey}: openedAt anterior ao validFrom conhecido do InstrumentVersion`,
            );
          }
          if (
            instrumentVersion.validTo !== null
            && compareInstants(openedAtInstant, requireAdapterInstant(instrumentVersion.validTo.toISOString(), 'validTo')) >= 0
          ) {
            throw new OpenedAtOutOfKnownRangeError(
              `bar ${submission.sourceRecordKey}: openedAt fora do intervalo de negócio conhecido (>= validTo) do InstrumentVersion`,
            );
          }

          return { submission, instrumentVersionId: instrumentVersion.id };
        }),
      );

      // Duplicate sourceRecordKey within the same batch always fails
      // closed, even when the payload is byte-identical.
      const seenInBatch = new Set<string>();
      for (const { submission } of barsWithContext) {
        if (seenInBatch.has(submission.sourceRecordKey)) {
          throw new DuplicateSourceRecordError(
            `sourceRecordKey=${submission.sourceRecordKey} aparece mais de uma vez no mesmo lote`,
          );
        }
        seenInBatch.add(submission.sourceRecordKey);
      }

      const byRecordKey = new Map<string, (typeof barsWithContext)[number]>();
      for (const item of barsWithContext) byRecordKey.set(item.submission.sourceRecordKey, item);

      // Deterministic topological order: chain depth first (root before
      // revision), then sourceRecordKey, so the batch's outcome never
      // depends on input array order. Cycle detection via a visiting set.
      const depthByKey = new Map<string, number>();
      const visiting = new Set<string>();
      const inBatchDepth = (item: (typeof barsWithContext)[number]): number => {
        const key = item.submission.sourceRecordKey;
        const cached = depthByKey.get(key);
        if (cached !== undefined) return cached;
        if (visiting.has(key)) {
          throw new BarChainViolationError(`ciclo de revisão detectado no lote em sourceRecordKey=${key}`);
        }
        visiting.add(key);
        let depth = 0;
        if (item.submission.isRevision && item.submission.supersedesSourceRecordKey) {
          const predecessorInBatch = byRecordKey.get(item.submission.supersedesSourceRecordKey);
          depth = predecessorInBatch ? inBatchDepth(predecessorInBatch) + 1 : 1;
        }
        visiting.delete(key);
        depthByKey.set(key, depth);
        return depth;
      };

      const orderedBars = [...barsWithContext].sort((a, b) => {
        const depthDifference = inBatchDepth(a) - inBatchDepth(b);
        if (depthDifference !== 0) return depthDifference;
        return a.submission.sourceRecordKey < b.submission.sourceRecordKey
          ? -1
          : a.submission.sourceRecordKey > b.submission.sourceRecordKey
            ? 1
            : 0;
      });

      const resolveBySourceRecordKey = async (sourceRecordKey: string): Promise<ResolvedBar | null> => {
        const row = await tx.versionedMarketBar.findUnique({
          where: { sourceKey_sourceRecordKey: { sourceKey, sourceRecordKey } },
          include: { createdByRun: true },
        });
        return row
          ? {
              id: row.id,
              instrumentVersionId: row.instrumentVersionId,
              sourceKey: row.sourceKey,
              sourceRecordKey: row.sourceRecordKey,
              timeframe: row.timeframe,
              openedAt: row.openedAt,
              closedAt: row.closedAt,
              sourceAvailableAt: row.sourceAvailableAt,
              openRaw: row.openRaw,
              highRaw: row.highRaw,
              lowRaw: row.lowRaw,
              closeRaw: row.closeRaw,
              priceScalePow: row.priceScalePow,
              volumeRaw: row.volumeRaw,
              volumeScalePow: row.volumeScalePow,
              volumeSemantics: row.volumeSemantics,
              tradeCount: row.tradeCount,
              priceBasis: row.priceBasis,
              quality: row.quality,
              rawSha256: row.rawSha256,
              revisionNumber: row.revisionNumber,
              supersedesBarId: row.supersedesBarId,
              createdByRunId: row.createdByRunId,
            }
          : null;
      };

      for (const { submission, instrumentVersionId } of orderedBars) {
        const existing = await resolveBySourceRecordKey(submission.sourceRecordKey);
        if (existing) {
          let chainIdentityMatches = false;
          if (submission.isRevision && submission.supersedesSourceRecordKey) {
            const declaredPredecessor = await resolveBySourceRecordKey(submission.supersedesSourceRecordKey);
            chainIdentityMatches =
              declaredPredecessor !== null
              && existing.supersedesBarId === declaredPredecessor.id
              && existing.revisionNumber === declaredPredecessor.revisionNumber + 1;
          } else if (!submission.isRevision) {
            chainIdentityMatches = existing.supersedesBarId === null && existing.revisionNumber === 1;
          }

          const identical =
            chainIdentityMatches
            && existing.instrumentVersionId === instrumentVersionId
            && existing.timeframe === submission.timeframe
            && existing.openedAt.toISOString() === new Date(submission.openedAt).toISOString()
            && existing.closedAt.toISOString() === new Date(submission.closedAt).toISOString()
            && existing.sourceAvailableAt.toISOString() === new Date(submission.sourceAvailableAt).toISOString()
            && existing.openRaw === submission.openRaw
            && existing.highRaw === submission.highRaw
            && existing.lowRaw === submission.lowRaw
            && existing.closeRaw === submission.closeRaw
            && existing.priceScalePow === submission.priceScalePow
            && existing.volumeRaw === submission.volumeRaw
            && existing.volumeScalePow === submission.volumeScalePow
            && existing.volumeSemantics === submission.volumeSemantics
            && (existing.tradeCount ?? null) === (submission.tradeCount ?? null)
            && existing.priceBasis === submission.priceBasis
            && existing.quality === submission.quality
            && existing.rawSha256 === submission.rawSha256;
          if (!identical) {
            throw new BarConflictError(
              `sourceRecordKey=${submission.sourceRecordKey} já existe com conteúdo ou identidade de cadeia divergente; reenvio idempotente exige identidade total`,
            );
          }
          continue;
        }

        let revisionNumber: number;
        let supersedesBarId: string | null;

        if (submission.isRevision) {
          const predecessorKey = submission.supersedesSourceRecordKey as string;
          let predecessor = await resolveBySourceRecordKey(predecessorKey);
          let predecessorCreatedByRunCompletedAt: Date | null = null;
          if (predecessor) {
            const predecessorRun = await tx.ingestionRun.findUnique({ where: { id: predecessor.createdByRunId } });
            predecessorCreatedByRunCompletedAt = predecessorRun?.completedAt ?? null;
          }
          if (!predecessor) {
            throw new UnknownPredecessorBarError(
              `revisão ${submission.sourceRecordKey}: predecessor sourceRecordKey=${predecessorKey} não existe`,
            );
          }
          if (
            predecessor.instrumentVersionId !== instrumentVersionId
            || predecessor.timeframe !== submission.timeframe
            || predecessor.openedAt.toISOString() !== new Date(submission.openedAt).toISOString()
          ) {
            throw new BarChainViolationError(
              `revisão ${submission.sourceRecordKey}: predecessor não compartilha instrumentVersionId/timeframe/openedAt/sourceKey`,
            );
          }
          if (
            compareInstants(
              requireAdapterInstant(submission.sourceAvailableAt, 'sourceAvailableAt'),
              requireAdapterInstant(predecessor.sourceAvailableAt.toISOString(), 'sourceAvailableAt predecessor'),
            ) <= 0
          ) {
            throw new BarChainViolationError(
              `revisão ${submission.sourceRecordKey}: sourceAvailableAt deve ser estritamente posterior ao predecessor`,
            );
          }
          // When the predecessor was created within this very run (same
          // atomic batch), there is no cross-run chronology to check —
          // both share the same completedAt and ordering is already
          // guaranteed by the batch's topological processing order.
          const predecessorInSameRun = predecessor.createdByRunId === normalizedRunId;
          if (
            !predecessorInSameRun
            && (!predecessorCreatedByRunCompletedAt
              || compareInstants(
                completedAtInstant,
                requireAdapterInstant(predecessorCreatedByRunCompletedAt.toISOString(), 'predecessor completedAt'),
              ) <= 0)
          ) {
            throw new BarChainViolationError(
              `revisão ${submission.sourceRecordKey}: completedAt desta run deve ser estritamente posterior ao completedAt da run que criou o predecessor`,
            );
          }
          const alreadySuperseded = await tx.versionedMarketBar.findFirst({
            where: { supersedesBarId: predecessor.id },
          });
          if (alreadySuperseded) {
            throw new PredecessorAlreadySupersededError(
              `revisão ${submission.sourceRecordKey}: predecessor sourceRecordKey=${predecessorKey} já foi supersedido por outra barra`,
            );
          }
          revisionNumber = predecessor.revisionNumber + 1;
          supersedesBarId = predecessor.id;
        } else {
          const existingChainHead = await tx.versionedMarketBar.findFirst({
            where: {
              instrumentVersionId,
              timeframe: submission.timeframe,
              sourceKey,
              openedAt: new Date(submission.openedAt),
            },
          });
          if (existingChainHead) {
            throw new BarChainViolationError(
              `bar ${submission.sourceRecordKey}: já existe uma cadeia para instrumentVersionId/timeframe/sourceKey/openedAt; envie como revisão`,
            );
          }
          revisionNumber = 1;
          supersedesBarId = null;
        }

        try {
          await tx.versionedMarketBar.create({
            data: {
              instrumentVersionId,
              sourceKey,
              sourceRecordKey: submission.sourceRecordKey,
              timeframe: submission.timeframe,
              openedAt: new Date(submission.openedAt),
              closedAt: new Date(submission.closedAt),
              sourceAvailableAt: new Date(submission.sourceAvailableAt),
              openRaw: submission.openRaw,
              highRaw: submission.highRaw,
              lowRaw: submission.lowRaw,
              closeRaw: submission.closeRaw,
              priceScalePow: submission.priceScalePow,
              volumeRaw: submission.volumeRaw,
              volumeScalePow: submission.volumeScalePow,
              volumeSemantics: submission.volumeSemantics,
              tradeCount: submission.tradeCount ?? null,
              priceBasis: submission.priceBasis,
              quality: submission.quality,
              rawSha256: submission.rawSha256,
              revisionNumber,
              supersedesBarId,
              createdByRunId: normalizedRunId,
            },
          });
        } catch (error) {
          if (isUniqueViolationOn(error, 'sourceRecordKey')) {
            throw new BarConflictError(`sourceRecordKey=${submission.sourceRecordKey} colidiu na escrita (concorrência)`);
          }
          if (isUniqueViolationOn(error, 'supersedesBarId')) {
            throw new PredecessorAlreadySupersededError(
              `revisão ${submission.sourceRecordKey}: predecessor foi supersedido por outra transação concorrente`,
            );
          }
          if (isUniqueViolationOn(error, 'revisionNumber')) {
            throw new BarChainViolationError(
              `bar ${submission.sourceRecordKey}: revisão da cadeia colidiu com outra transação concorrente`,
            );
          }
          throw error;
        }
      }

      const transitioned = await tx.ingestionRun.updateMany({
        where: { id: normalizedRunId, status: 'RUNNING' },
        data: { status: 'SUCCEEDED', completedAt: new Date(completedAt), summary: normalizedSummary },
      });
      if (transitioned.count !== 1) {
        throw new RunNotRunningError(`run ${normalizedRunId} perdeu a transição RUNNING → SUCCEEDED`);
      }
    });
  }
}
