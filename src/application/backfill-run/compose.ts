import type { PrismaClient } from '@prisma/client';
import { PrismaBackfillRunRepository } from '../../adapters/prisma/backfill-run';
import { BackfillRunService } from './service';

export function createBackfillRunService(prisma: PrismaClient): BackfillRunService {
  return new BackfillRunService({ repository: new PrismaBackfillRunRepository(prisma) });
}
