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
      },
    });
    return toBacktestRun(row);
  }

  async findById(backtestId: string): Promise<BacktestRunPersistedShape | null> {
    const row = await this.prisma.backtestRun.findUnique({ where: { backtestId } });
    return row ? toBacktestRun(row) : null;
  }

  async findByModelVersion(modelVersionId: string): Promise<readonly BacktestRunPersistedShape[]> {
    const rows = await this.prisma.backtestRun.findMany({
      where: { modelVersionId },
      orderBy: [{ createdAt: 'asc' }, { backtestId: 'asc' }],
    });
    return Object.freeze(rows.map(toBacktestRun));
  }
}
