import type { PrismaClient } from '@prisma/client';
import { PrismaSignalRepository } from '../../adapters/prisma/signal';
import { PrismaModelVersionRepository } from '../../adapters/prisma/model-version';
import { SignalService } from './service';

export function createSignalService(prisma: PrismaClient): SignalService {
  return new SignalService({
    signalRepository: new PrismaSignalRepository(prisma),
    modelVersionRepository: new PrismaModelVersionRepository(prisma),
  });
}
