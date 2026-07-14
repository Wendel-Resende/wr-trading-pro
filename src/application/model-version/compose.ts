import type { PrismaClient } from '@prisma/client';
import { PrismaModelVersionRepository } from '../../adapters/prisma/model-version';
import { ModelVersionService } from './service';

export function createModelVersionService(prisma: PrismaClient): ModelVersionService {
  return new ModelVersionService({ modelVersionRepository: new PrismaModelVersionRepository(prisma) });
}
