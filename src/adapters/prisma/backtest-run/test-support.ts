import type { PrismaClient } from '@prisma/client';
import type { BacktestRunSubmission } from '../../../domain/v1/ports/backtest-repository';
import { PrismaBacktestRepository } from './repository';

export async function insertBacktestRunForTest(prisma: PrismaClient, submission: BacktestRunSubmission): Promise<string> {
  const repo = new PrismaBacktestRepository(prisma);
  const run = await repo.create(submission);
  return run.backtestId;
}
