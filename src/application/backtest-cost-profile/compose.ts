import type { PrismaClient } from '@prisma/client';
import { PrismaBacktestCostProfileRepository } from '../../adapters/prisma/backtest-cost-profile';
import { BacktestCostProfileService } from './service';

export function createBacktestCostProfileService(prisma: PrismaClient): BacktestCostProfileService {
  return new BacktestCostProfileService({ repository: new PrismaBacktestCostProfileRepository(prisma) });
}
