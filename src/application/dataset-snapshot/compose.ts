import type { PrismaClient } from '@prisma/client';
import { PrismaDatasetSnapshotRepository } from '../../adapters/prisma/dataset-snapshot';
import { PrismaIngestionLedger } from '../../adapters/prisma/reference-data';
import { DatasetSnapshotService } from './service';

/**
 * Composition helper for route handlers: wires the read-only
 * DatasetSnapshot application service to the existing Prisma adapters,
 * given an already-constructed PrismaClient. Never constructs a
 * PrismaClient itself.
 */
export function createDatasetSnapshotService(prisma: PrismaClient): DatasetSnapshotService {
  return new DatasetSnapshotService({
    datasetSnapshotRepository: new PrismaDatasetSnapshotRepository(prisma),
    ingestionLedger: new PrismaIngestionLedger(prisma),
  });
}
