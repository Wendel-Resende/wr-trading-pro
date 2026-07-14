import type {
  HumanApprovalReceipt as HumanApprovalReceiptRow,
  OrderIntent as OrderIntentRow,
} from '@prisma/client';
import type {
  HumanApprovalReceipt,
  OrderIntent,
  OrderIntentDirection,
  OrderIntentStatus,
} from '../../../domain/v1/models/order-intent';

export const toHumanApprovalReceipt = (row: HumanApprovalReceiptRow): HumanApprovalReceipt => ({
  approvalId: row.approvalId,
  decisionId: row.decisionId,
  approvedBy: row.approvedBy,
  approvedAt: row.approvedAt.toISOString(),
  policyVersion: row.policyVersion,
  decisionOutcome: row.decisionOutcome as HumanApprovalReceipt['decisionOutcome'],
  createdAt: row.createdAt.toISOString(),
});

export const toOrderIntent = (row: OrderIntentRow): OrderIntent => ({
  intentId: row.intentId,
  decisionId: row.decisionId,
  approvalId: row.approvalId,
  idempotencyKey: row.idempotencyKey,
  requestedBy: row.requestedBy,
  approvedBy: row.approvedBy,
  instrumentId: row.instrumentId,
  direction: row.direction as OrderIntentDirection,
  quantity: row.quantity,
  status: row.status as OrderIntentStatus,
  policyVersion: row.policyVersion,
  decisionTime: row.decisionTime.toISOString(),
  knowledgeTime: row.knowledgeTime.toISOString(),
  createdAt: row.createdAt.toISOString(),
  cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
});
