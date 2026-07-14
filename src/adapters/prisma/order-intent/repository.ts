import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type {
  HumanApprovalReceipt,
  HumanApprovalReceiptSubmission,
  OrderIntent,
  OrderIntentSubmission,
} from '../../../domain/v1/models/order-intent';
import type { OrderIntentRepository } from '../../../domain/v1/ports/order-intent-repository';
import { toHumanApprovalReceipt, toOrderIntent } from './mapping';

/**
 * Prisma implementation of OrderIntentRepository (Fase 3 / Item 4).
 * `approvalId`/`intentId` are always generated server-side
 * (`randomUUID()`), never accepted from the caller. `idempotencyKey`
 * uniqueness is enforced by the database (`@unique`); `cancelIntent` is
 * the only mutation, and only transitions `CREATED -> CANCELLED`.
 */
export class PrismaOrderIntentRepository implements OrderIntentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async saveApproval(submission: HumanApprovalReceiptSubmission): Promise<HumanApprovalReceipt> {
    const approvalId = randomUUID();
    const row = await this.prisma.humanApprovalReceipt.create({
      data: {
        approvalId,
        decisionId: submission.decisionId,
        approvedBy: submission.approvedBy,
        approvedAt: new Date(),
        policyVersion: submission.policyVersion,
        decisionOutcome: 'APPROVED',
      },
    });
    return toHumanApprovalReceipt(row);
  }

  async saveIntent(submission: OrderIntentSubmission): Promise<OrderIntent> {
    const intentId = randomUUID();
    const row = await this.prisma.orderIntent.create({
      data: {
        intentId,
        decisionId: submission.decisionId,
        approvalId: submission.approvalId,
        idempotencyKey: submission.idempotencyKey,
        requestedBy: submission.requestedBy,
        approvedBy: submission.approvedBy,
        instrumentId: submission.instrumentId,
        direction: submission.direction,
        quantity: submission.quantity,
        status: 'CREATED',
        policyVersion: submission.policyVersion,
        decisionTime: new Date(submission.decisionTime),
        knowledgeTime: new Date(submission.knowledgeTime),
      },
    });
    return toOrderIntent(row);
  }

  async findIntentByKey(idempotencyKey: string): Promise<OrderIntent | null> {
    const row = await this.prisma.orderIntent.findUnique({ where: { idempotencyKey } });
    return row ? toOrderIntent(row) : null;
  }

  async findIntentById(intentId: string): Promise<OrderIntent | null> {
    const row = await this.prisma.orderIntent.findUnique({ where: { intentId } });
    return row ? toOrderIntent(row) : null;
  }

  async findIntentsByDecisionId(decisionId: string): Promise<readonly OrderIntent[]> {
    const rows = await this.prisma.orderIntent.findMany({
      where: { decisionId },
      orderBy: [{ createdAt: 'asc' }, { intentId: 'asc' }],
    });
    return Object.freeze(rows.map(toOrderIntent));
  }

  async cancelIntent(intentId: string, cancelledAt: string): Promise<OrderIntent | null> {
    const existing = await this.prisma.orderIntent.findUnique({ where: { intentId } });
    if (!existing || existing.status !== 'CREATED') return null;

    const row = await this.prisma.orderIntent.update({
      where: { intentId },
      data: { status: 'CANCELLED', cancelledAt: new Date(cancelledAt) },
    });
    return toOrderIntent(row);
  }
}
