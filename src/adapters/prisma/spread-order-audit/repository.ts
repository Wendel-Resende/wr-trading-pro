import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { SpreadOrderAuditEntry, SpreadOrderAuditSubmission } from '../../../domain/v1/models/spread-order-audit';
import type { SpreadOrderAuditRepository } from '../../../domain/v1/ports/option-repository';
import { toSpreadOrderAuditEntry } from './mapping';

/**
 * Prisma implementation of `SpreadOrderAuditRepository` (Fase 6 —
 * Consolidação). Append-only: there is no update/delete method — a new
 * row is the only mutation this repository can perform.
 */
export class PrismaSpreadOrderAuditRepository implements SpreadOrderAuditRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async append(submission: SpreadOrderAuditSubmission): Promise<SpreadOrderAuditEntry> {
    const auditId = randomUUID();
    const row = await this.prisma.spreadOrderAudit.create({
      data: {
        auditId,
        orderId: submission.orderId,
        action: submission.action,
        requestedBy: submission.requestedBy,
        payloadJson: submission.payloadJson,
        policyVersion: submission.policyVersion,
        decisionTime: new Date(submission.decisionTime),
        knowledgeTime: new Date(submission.knowledgeTime),
      },
    });
    return toSpreadOrderAuditEntry(row);
  }

  async findByOrderId(orderId: string): Promise<readonly SpreadOrderAuditEntry[]> {
    const rows = await this.prisma.spreadOrderAudit.findMany({
      where: { orderId },
      orderBy: [{ createdAt: 'asc' }, { auditId: 'asc' }],
    });
    return Object.freeze(rows.map(toSpreadOrderAuditEntry));
  }
}
