import type { PrismaClient } from '@prisma/client';
import { PrismaSpreadOrderAuditRepository } from '../../adapters/prisma/spread-order-audit';
import { SpreadOrderAuditService } from './service';

export function createSpreadOrderAuditService(prisma: PrismaClient): SpreadOrderAuditService {
  return new SpreadOrderAuditService({
    spreadOrderAuditRepository: new PrismaSpreadOrderAuditRepository(prisma),
  });
}
