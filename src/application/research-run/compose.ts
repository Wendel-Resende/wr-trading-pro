import type { PrismaClient } from '@prisma/client';
import { PrismaResearchRunRepository } from '../../adapters/prisma/research-run';
import { ResearchRunService } from './service';

export function createResearchRunService(prisma: PrismaClient): ResearchRunService {
  return new ResearchRunService({ researchRunRepository: new PrismaResearchRunRepository(prisma) });
}
