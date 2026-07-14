import type { RiskDecision, RiskEvaluationContext, RiskPolicyConfig, TradeProposal } from '../../domain/v1/models/risk-policy';
import { RISK_POLICY_VERSION, evaluatePolicy } from '../../domain/v1/models/risk-policy';
import type { RiskPolicyRepository } from '../../domain/v1/ports/risk-policy-repository';
import { compareInstants, parseInstant } from '../../domain/v1/time';
import { ReadModelError } from '../read-models-v1/errors';

export interface RiskPolicyServicePorts {
  readonly riskPolicyRepository: RiskPolicyRepository;
}

export interface EvaluateRiskPolicyInputV1 {
  readonly runId: string;
  readonly requestedBy: string;
  readonly proposal: TradeProposal;
  readonly context: RiskEvaluationContext;
  readonly decisionTime: string;
}

export interface EvaluateRiskPolicyResultV1 {
  readonly decisionId: string;
  readonly runId: string;
  readonly outcome: RiskDecision['outcome'];
  readonly reasons: RiskDecision['reasons'];
  readonly policyVersion: string;
}

function requireInstant(value: string, field: string): void {
  if (parseInstant(value) === null) {
    throw new ReadModelError('INVALID_BODY', `${field} inválido: timestamp ISO-8601 exigido`);
  }
}

/**
 * Application service for the deterministic RiskPolicy engine (Fase 3 /
 * Item 3). Depends only on the injected RiskPolicyRepository port —
 * never calls an LLM, `process.env`, ExecutionBroker, or
 * `tradingAgentsService`. `evaluate` orquestra validação de timestamps
 * → contagem de decisões prévias do run → `evaluatePolicy` (puro) →
 * persistência do ledger de auditoria.
 */
export class RiskPolicyService {
  constructor(private readonly ports: RiskPolicyServicePorts) {}

  async evaluate(input: EvaluateRiskPolicyInputV1, config: RiskPolicyConfig): Promise<EvaluateRiskPolicyResultV1> {
    requireInstant(input.decisionTime, 'decisionTime');
    const knowledgeTime = new Date().toISOString();
    if (compareInstants(parseInstant(knowledgeTime)!, parseInstant(input.decisionTime)!) > 0) {
      throw new ReadModelError('INVALID_BODY', 'knowledgeTime não pode ser posterior a decisionTime');
    }

    const priorDecisionsForRun = await this.ports.riskPolicyRepository.countByRunId(input.runId);
    const result = evaluatePolicy(input.proposal, input.context, config, priorDecisionsForRun);

    const decision = await this.ports.riskPolicyRepository.saveDecision({
      runId: input.runId,
      requestedBy: input.requestedBy,
      instrumentId: input.proposal.instrumentId,
      direction: input.proposal.direction,
      outcome: result.outcome,
      reasons: result.reasons,
      policyVersion: config.policyVersion,
      proposalJson: JSON.stringify(input.proposal),
      contextJson: JSON.stringify(input.context),
      policySnapshotJson: JSON.stringify({ limits: input.context.limits, tradingEnabled: config.tradingEnabled }),
      decisionTime: input.decisionTime,
      knowledgeTime,
    });

    return {
      decisionId: decision.decisionId,
      runId: decision.runId,
      outcome: decision.outcome,
      reasons: decision.reasons,
      policyVersion: decision.policyVersion,
    };
  }

  async getDecision(decisionId: string): Promise<RiskDecision> {
    const decision = await this.ports.riskPolicyRepository.findByDecisionId(decisionId);
    if (!decision) throw new ReadModelError('RISK_DECISION_NOT_FOUND', 'RiskDecision não encontrada');
    return decision;
  }

  async listByRunId(runId: string): Promise<readonly RiskDecision[]> {
    return this.ports.riskPolicyRepository.findByRunId(runId);
  }
}

export const DEFAULT_POLICY_VERSION = RISK_POLICY_VERSION;
