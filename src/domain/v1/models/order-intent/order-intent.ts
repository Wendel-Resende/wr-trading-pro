/**
 * Fase 3 / Item 4 — aprovação humana + `idempotency key` (gate de execução).
 *
 * Consome um `RiskDecision` (Item 3) já `APPROVED` e materializa a
 * intenção auditável de ordem (`OrderIntent`), nunca a ordem executada:
 * `ExecutionBroker` não é referenciado neste item. Puro e determinístico:
 * sem LLM, sem I/O, sem `process.env`.
 */

export const ORDER_INTENT_VERSION = 'order-intent/v1' as const;

export type OrderIntentDirection = 'BUY' | 'SELL';

export type OrderIntentStatus = 'CREATED' | 'CANCELLED';

/** Injetado pelo adapter a partir de `process.env.WR_TRADING_ENABLED`; o núcleo nunca lê `process.env` diretamente. */
export interface OrderIntentConfig {
  readonly tradingEnabled: boolean;
  readonly policyVersion: string;
}

export interface HumanApprovalReceipt {
  readonly approvalId: string;
  readonly decisionId: string;
  readonly approvedBy: string;
  readonly approvedAt: string;
  readonly policyVersion: string;
  readonly decisionOutcome: 'APPROVED';
  readonly createdAt: string;
}

/** Payload usado para persistir uma nova `HumanApprovalReceipt` (identidade sempre gerada no servidor). */
export interface HumanApprovalReceiptSubmission {
  readonly decisionId: string;
  readonly approvedBy: string;
  readonly policyVersion: string;
}

export interface OrderIntent {
  readonly intentId: string;
  readonly decisionId: string;
  readonly approvalId: string;
  readonly idempotencyKey: string;
  readonly requestedBy: string;
  readonly approvedBy: string;
  readonly instrumentId: string;
  readonly direction: OrderIntentDirection;
  readonly quantity: number;
  readonly status: OrderIntentStatus;
  readonly policyVersion: string;
  readonly decisionTime: string;
  readonly knowledgeTime: string;
  readonly createdAt: string;
  readonly cancelledAt: string | null;
}

/** Payload usado para persistir uma nova `OrderIntent` (identidade sempre gerada no servidor). */
export interface OrderIntentSubmission {
  readonly decisionId: string;
  readonly approvalId: string;
  readonly idempotencyKey: string;
  readonly requestedBy: string;
  readonly approvedBy: string;
  readonly instrumentId: string;
  readonly direction: OrderIntentDirection;
  readonly quantity: number;
  readonly policyVersion: string;
  readonly decisionTime: string;
  readonly knowledgeTime: string;
}

/** Subconjunto do `RiskDecision` (Item 3) necessário para resolver a aprovação/intenção (núcleo puro, sem acoplamento ao módulo inteiro). */
export interface ApprovableRiskDecision {
  readonly decisionId: string;
  readonly outcome: 'APPROVED' | 'REJECTED';
  readonly direction: 'BUY' | 'SELL' | 'HOLD';
  readonly instrumentId: string;
  readonly policyVersion: string;
  readonly decisionTime: string;
  readonly knowledgeTime: string;
}

export type OrderIntentRejectionReason =
  | 'TRADING_DISABLED'
  | 'DECISION_NOT_APPROVED'
  | 'DECISION_NOT_ACTIONABLE';

export type ResolveApprovalResult =
  | { readonly ok: true; readonly direction: OrderIntentDirection }
  | { readonly ok: false; readonly reason: OrderIntentRejectionReason };

/**
 * Núcleo puro que resolve se um `RiskDecision` pode originar uma
 * `HumanApprovalReceipt` + `OrderIntent` (regras R1/R3/R4 da spec, em
 * ordem fixa). Não persiste nada; apenas decide.
 */
export function resolveApprovalFromDecision(
  decision: ApprovableRiskDecision,
  config: OrderIntentConfig,
): ResolveApprovalResult {
  if (!config.tradingEnabled) {
    return { ok: false, reason: 'TRADING_DISABLED' };
  }
  if (decision.outcome !== 'APPROVED') {
    return { ok: false, reason: 'DECISION_NOT_APPROVED' };
  }
  if (decision.direction === 'HOLD') {
    return { ok: false, reason: 'DECISION_NOT_ACTIONABLE' };
  }
  return { ok: true, direction: decision.direction };
}

/**
 * Núcleo puro que monta o payload de `OrderIntent` a partir do
 * `RiskDecision` aprovado + `HumanApprovalReceipt` + entrada do chamador
 * (`quantity`, `idempotencyKey`). `direction`/`instrumentId` derivam
 * sempre do `RiskDecision`, nunca do corpo da requisição.
 */
export function createOrderIntent(
  decision: ApprovableRiskDecision,
  direction: OrderIntentDirection,
  approval: HumanApprovalReceipt,
  input: { readonly idempotencyKey: string; readonly quantity: number; readonly requestedBy: string },
): OrderIntentSubmission {
  return {
    decisionId: decision.decisionId,
    approvalId: approval.approvalId,
    idempotencyKey: input.idempotencyKey,
    requestedBy: input.requestedBy,
    approvedBy: approval.approvedBy,
    instrumentId: decision.instrumentId,
    direction,
    quantity: input.quantity,
    policyVersion: decision.policyVersion,
    decisionTime: decision.decisionTime,
    knowledgeTime: decision.knowledgeTime,
  };
}
