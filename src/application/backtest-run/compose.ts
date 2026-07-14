import type { PrismaClient } from '@prisma/client';
import { PrismaBacktestRepository } from '../../adapters/prisma/backtest-run';
import { PrismaResearchRunRepository } from '../../adapters/prisma/research-run';
import { PrismaModelVersionRepository } from '../../adapters/prisma/model-version';
import { BacktestRunService } from './service';

export function createBacktestRunService(prisma: PrismaClient): BacktestRunService {
  return new BacktestRunService({
    backtestRepository: new PrismaBacktestRepository(prisma),
    researchRunRepository: new PrismaResearchRunRepository(prisma),
    modelVersionRepository: new PrismaModelVersionRepository(prisma),
  });
}
