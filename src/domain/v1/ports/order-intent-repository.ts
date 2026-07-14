import type {
  HumanApprovalReceipt,
  HumanApprovalReceiptSubmission,
  OrderIntent,
  OrderIntentSubmission,
} from '../models/order-intent';

/**
 * Port do ledger de aprovação humana + intenção auditável (Fase 3 / Item
 * 4). `saveApproval`/`saveIntent` são apend-only; `cancelIntent` é a
 * única mutação permitida (transição `CREATED -> CANCELLED`).
 */
export interface OrderIntentRepository {
  saveApproval(submission: HumanApprovalReceiptSubmission): Promise<HumanApprovalReceipt>;
  saveIntent(submission: OrderIntentSubmission): Promise<OrderIntent>;
  findIntentByKey(idempotencyKey: string): Promise<OrderIntent | null>;
  findIntentById(intentId: string): Promise<OrderIntent | null>;
  findIntentsByDecisionId(decisionId: string): Promise<readonly OrderIntent[]>;
  cancelIntent(intentId: string, cancelledAt: string): Promise<OrderIntent | null>;
}
