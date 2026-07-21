import type { PrismaClient } from '@prisma/client';
import type { BacktestCostProfile, BacktestCostProfileSubmission } from '../../../domain/v1/models/backtest-cost-profile';
import type { BacktestCostProfileRepository } from '../../../domain/v1/ports/backtest-cost-profile-repository';
import { toBacktestCostProfile } from './mapping';

export class PrismaBacktestCostProfileRepository implements BacktestCostProfileRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(submission: BacktestCostProfileSubmission): Promise<BacktestCostProfile> {
    const row = await this.prisma.backtestCostProfile.create({
      data: {
        version: submission.version,
        label: submission.label,
        fixedBrokerage: submission.fixedBrokerage,
        emolumentsPct: submission.emolumentsPct,
        spreadBps: submission.spreadBps,
        slippageBps: submission.slippageBps,
        lotSize: submission.lotSize,
        source: submission.source,
        createdBy: submission.createdBy,
      },
    });
    return toBacktestCostProfile(row);
  }

  async findById(id: string): Promise<BacktestCostProfile | null> {
    const row = await this.prisma.backtestCostProfile.findUnique({ where: { id } });
    return row ? toBacktestCostProfile(row) : null;
  }

  async archive(id: string, archivedAt: string, archivedBy: string): Promise<BacktestCostProfile> {
    const row = await this.prisma.backtestCostProfile.update({
      where: { id },
      data: { archivedAt: new Date(archivedAt), archivedBy },
    });
    return toBacktestCostProfile(row);
  }
}
