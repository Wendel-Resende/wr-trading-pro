import type { PrismaClient } from '@prisma/client';
import { PrismaCvmFactRepository, PrismaCvmFilingRepository, PrismaShareCapitalFactRepository } from '../../adapters/prisma/cvm';
import { PrismaIngestionLedger, PrismaInstrumentRepository } from '../../adapters/prisma/reference-data';
import { PrismaMarketBarRepository } from '../../adapters/prisma/market-bar';
import { ReadModelV1Service } from './service';

/**
 * Composition helper for route handlers: wires the read-only v1
 * application service to the existing Prisma adapters, given an
 * already-constructed PrismaClient (the `@/lib/prisma` singleton in
 * production, or a temporary test client in the test harness). Never
 * constructs a PrismaClient itself.
 */
export function createReadModelV1Service(prisma: PrismaClient): ReadModelV1Service {
  return new ReadModelV1Service({
    instrumentRepository: new PrismaInstrumentRepository(prisma),
    cvmFilingRepository: new PrismaCvmFilingRepository(prisma),
    cvmFactRepository: new PrismaCvmFactRepository(prisma),
    shareCapitalFactRepository: new PrismaShareCapitalFactRepository(prisma),
    marketBarRepository: new PrismaMarketBarRepository(prisma),
    ingestionLedger: new PrismaIngestionLedger(prisma),
  });
}
