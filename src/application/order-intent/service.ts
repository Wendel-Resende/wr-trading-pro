import type { OrderIntent, OrderIntentConfig } from '../../domain/v1/models/order-intent';
import { createOrderIntent, resolveApprovalFromDecision } from '../../domain/v1/models/order-intent';
import type { OrderIntentRepository } from '../../domain/v1/ports/order-intent-repository';
import type { RiskPolicyRepository } from '../../domain/v1/ports/risk-policy-repository';
import { ReadModelError } from '../read-models-v1/errors';

export interface OrderIntentServicePorts {
  readonly orderIntentRepository: OrderIntentRepository;
  readonly riskPolicyRepository: RiskPolicyRepository;
}

export interface CreateOrderIntentInputV1 {
  readonly decisionId: string;
  readonly idempotencyKey: string;
  readonly quantity: number;
  readonly decisionTime: string;
  readonly requestedBy: string;
  readonly approvedBy: string;
}

export interface CreateOrderIntentResultV1 {
  readonly replayed: boolean;
  readonly intent: OrderIntent;
}

/**
 * Application service for human approval + idempotency key gate (Fase 3
 * / Item 4). Depends only on the injected ports — never calls an LLM,
 * `process.env`, `ExecutionBroker`, or `tradingAgentsService`.
 * `create` orquestra, em ordem fixa: idempotência (R5) → kill switch (R1)
 * → decisão existe (R2) → decisão aprovada (R3) → ação executável (R4) →
 * aprovação humana (R6) → intenção (R7).
 */
export class OrderIntentService {
  constructor(private readonly ports: OrderIntentServicePorts) {}

  async create(input: CreateOrderIntentInputV1, config: OrderIntentConfig): Promise<CreateOrderIntentResultV1> {
    // R1 — KILL_SWITCH: gate de criação, checado antes de qualquer outra regra (inclusive idempotência).
    if (!config.tradingEnabled) {
      throw new ReadModelError('TRADING_DISABLED', 'kill switch desabilitado: criação de OrderIntent bloqueada');
    }

    // R2 — DECISION_REQUIRED
    const decision = await this.ports.riskPolicyRepository.findByDecisionId(input.decisionId);
    if (!decision) {
      throw new ReadModelError('RISK_DECISION_NOT_FOUND', 'RiskDecision não encontrada');
    }

    // R3/R4 — DECISION_NOT_APPROVED / HOLD_NOT_ACTIONABLE
    const resolution = resolveApprovalFromDecision(decision, config);
    if (!resolution.ok) {
      if (resolution.reason === 'DECISION_NOT_APPROVED') {
        throw new ReadModelError('DECISION_NOT_APPROVED', 'RiskDecision não está APPROVED');
      }
      throw new ReadModelError('DECISION_NOT_ACTIONABLE', 'RiskDecision HOLD não é ação executável');
    }

    // R5 — IDEMPOTENCY: reenvio com a mesma chave retorna a intent existente, sem recriar.
    const existing = await this.ports.orderIntentRepository.findIntentByKey(input.idempotencyKey);
    if (existing) {
      return { replayed: true, intent: existing };
    }

    // R6 — APPROVAL
    const approval = await this.ports.orderIntentRepository.saveApproval({
      decisionId: decision.decisionId,
      approvedBy: input.approvedBy,
      policyVersion: decision.policyVersion,
    });

    const submission = createOrderIntent(decision, resolution.direction, approval, {
      idempotencyKey: input.idempotencyKey,
      quantity: input.quantity,
      requestedBy: input.requestedBy,
    });

    const intent = await this.ports.orderIntentRepository.saveIntent(submission);
    return { replayed: false, intent };
  }

  async getIntent(intentId: string): Promise<OrderIntent> {
    const intent = await this.ports.orderIntentRepository.findIntentById(intentId);
    if (!intent) throw new ReadModelError('ORDER_INTENT_NOT_FOUND', 'OrderIntent não encontrada');
    return intent;
  }

  async listByDecisionId(decisionId: string): Promise<readonly OrderIntent[]> {
    return this.ports.orderIntentRepository.findIntentsByDecisionId(decisionId);
  }

  async cancel(intentId: string): Promise<OrderIntent> {
    const cancelled = await this.ports.orderIntentRepository.cancelIntent(intentId, new Date().toISOString());
    if (!cancelled) {
      const existing = await this.ports.orderIntentRepository.findIntentById(intentId);
      if (!existing) throw new ReadModelError('ORDER_INTENT_NOT_FOUND', 'OrderIntent não encontrada');
      throw new ReadModelError('INTENT_NOT_CANCELABLE', 'OrderIntent não está em estado cancelável');
    }
    return cancelled;
  }
}
