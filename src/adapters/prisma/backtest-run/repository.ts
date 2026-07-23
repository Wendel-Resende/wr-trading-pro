import type { PrismaClient } from '@prisma/client';
import type { BacktestRepository, BacktestRunPersistedShape, BacktestRunSubmission } from '../../../domain/v1/ports/backtest-repository';
import { toBacktestRun } from './mapping';

export class PrismaBacktestRepository implements BacktestRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(submission: BacktestRunSubmission): Promise<BacktestRunPersistedShape> {
    const row = await this.prisma.backtestRun.create({
      data: {
        researchRunId: submission.researchRunId,
        modelVersionId: submission.modelVersionId,
        instrumentId: submission.instrumentId,
        entryRule: submission.entryRule,
        costsJson: submission.costsJson,
        windowStart: new Date(submission.windowStart),
        windowEnd: new Date(submission.windowEnd),
        metricsJson: submission.metricsJson,
        embargoDays: submission.embargoDays,
        costProfileId: submission.costProfileId ?? null,
        costProfileVersion: submission.costProfileVersion ?? null,
        predictionHorizonBars: submission.predictionHorizonBars ?? null,
        exitRuleKey: submission.exitRuleKey ?? null,
        idempotencyKey: submission.idempotencyKey ?? null,
        metricsSchemaVersion: submission.metricsSchemaVersion ?? null,
      },
    });
    return toBacktestRun(row);
  }

  async findById(backtestId: string): Promise<BacktestRunPersistedShape | null> {
    const row = await this.prisma.backtestRun.findUnique({ where: { backtestId } });
    return row ? toBacktestRun(row) : null;
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<BacktestRunPersistedShape | null> {
    const row = await this.prisma.backtestRun.findUnique({ where: { idempotencyKey } });
    return row ? toBacktestRun(row) : null;
  }

  async findByModelVersion(modelVersionId: string, limit?: number, cursor?: string): Promise<readonly BacktestRunPersistedShape[]> {
    const rows = await this.prisma.backtestRun.findMany({
      where: { modelVersionId },
      // Bloqueador 3 (revisão final do Guardião): ordenação estável e
      // determinística `createdAt desc, backtestId desc` — mais recente
      // primeiro, para paginação server-side consistente com research-runs
      // e cost-profiles.
      orderBy: [{ createdAt: 'desc' }, { backtestId: 'desc' }],
      ...(limit !== undefined ? { take: limit } : {}),
      ...(cursor ? { cursor: { backtestId: cursor }, skip: 1 } : {}),
    });
    return Object.freeze(rows.map(toBacktestRun));
  }
}
