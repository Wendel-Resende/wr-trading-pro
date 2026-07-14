/**
 * Fase 6 — Consolidação. Trilha de auditoria append-only para ações de
 * ordens de spread (`SpreadOrder`, legado em `prisma/schema.prisma`).
 * Reutiliza o padrão `RiskDecision`/`OrderIntent` (Fase 3): o ledger
 * apenas REGISTRA a intenção (criar/cancelar), nunca executa nada —
 * `ExecutionBroker` continua desabilitado. Puro, sem I/O, sem `process.env`.
 */

export const SPREAD_ORDER_AUDIT_VERSION = 'spread-order-audit/v1' as const;

export type SpreadOrderAuditAction = 'CREATE' | 'CANCEL';

export interface SpreadOrderAuditEntry {
  readonly auditId: string;
  readonly orderId: string;
  readonly action: SpreadOrderAuditAction;
  readonly requestedBy: string;
  readonly payloadJson: string;
  readonly policyVersion: string;
  readonly decisionTime: string;
  readonly knowledgeTime: string;
  readonly createdAt: string;
}

/** Payload usado para persistir uma nova entrada de ledger (identidade sempre gerada no servidor). */
export interface SpreadOrderAuditSubmission {
  readonly orderId: string;
  readonly action: SpreadOrderAuditAction;
  readonly requestedBy: string;
  readonly payloadJson: string;
  readonly policyVersion: string;
  readonly decisionTime: string;
  readonly knowledgeTime: string;
}

/**
 * Núcleo puro que monta o payload de auditoria a partir da entrada do
 * chamador. `knowledgeTime` nunca pode exceder `decisionTime` (CR-9,
 * ponto-no-tempo) — a validação é responsabilidade do chamador via
 * `assertNoLookahead`.
 */
export function createSpreadOrderAuditSubmission(input: {
  readonly orderId: string;
  readonly action: SpreadOrderAuditAction;
  readonly requestedBy: string;
  readonly payload: unknown;
  readonly policyVersion: string;
  readonly decisionTime: string;
  readonly knowledgeTime: string;
}): SpreadOrderAuditSubmission {
  return {
    orderId: input.orderId,
    action: input.action,
    requestedBy: input.requestedBy,
    payloadJson: JSON.stringify(input.payload),
    policyVersion: input.policyVersion,
    decisionTime: input.decisionTime,
    knowledgeTime: input.knowledgeTime,
  };
}

export function isNoLookahead(decisionTime: string, knowledgeTime: string): boolean {
  return new Date(knowledgeTime).getTime() <= new Date(decisionTime).getTime();
}
