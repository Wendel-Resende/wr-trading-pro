import type { PrismaClient } from '@prisma/client';
import { PrismaMlTrainingRunRepository } from '../../adapters/prisma/ml-training-run';
import { MlTrainingRunService } from './service';

export function createMlTrainingRunService(prisma: PrismaClient): MlTrainingRunService {
  return new MlTrainingRunService({ repository: new PrismaMlTrainingRunRepository(prisma) });
}
