import type { PrismaClient } from '@prisma/client';
import { PrismaFeatureValueRepository } from '../../adapters/prisma/feature-value';
import { PrismaIngestionLedger } from '../../adapters/prisma/reference-data';
import { FeatureValueService } from './service';

/**
 * Composition helper for route handlers: wires the read-only
 * FeatureValue application service to the existing Prisma adapters,
 * given an already-constructed PrismaClient. Never constructs a
 * PrismaClient itself.
 */
export function createFeatureValueService(prisma: PrismaClient): FeatureValueService {
  return new FeatureValueService({
    featureValueRepository: new PrismaFeatureValueRepository(prisma),
    ingestionLedger: new PrismaIngestionLedger(prisma),
  });
}
