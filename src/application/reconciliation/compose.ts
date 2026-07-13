import type { PrismaClient } from '@prisma/client';
import { PrismaReconciliationRepository } from '../../adapters/prisma/reconciliation';
import { ReconciliationService } from './service';

/**
 * Composition helper for route handlers: wires the read-only
 * Reconciliation application service to the existing Prisma adapter,
 * given an already-constructed PrismaClient. Never constructs a
 * PrismaClient itself.
 */
export function createReconciliationService(prisma: PrismaClient): ReconciliationService {
  return new ReconciliationService({
    reconciliationRepository: new PrismaReconciliationRepository(prisma),
  });
}
