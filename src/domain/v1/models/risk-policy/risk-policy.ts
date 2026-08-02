/**
 * Fase 3 / Item 3 — motor `RiskPolicy` determinístico.
 *
 * Recebe um `TradeProposal` (saída do `AgentRun` do Item 2) mais um
 * contexto de avaliação e decide `APPROVED`/`REJECTED` com razões
 * explícitas. Puro e determinístico: sem LLM, sem I/O, sem
 * `process.env`. Nunca cria `OrderIntent`; aprovação humana e
 * idempotency key ficam no Item 4.
 */

import type { TradeProposal } from '../agent-run';

export type { TradeProposal } from '../agent-run';

export const RISK_POLICY_VERSION = 'risk-policy/v1' as const;

export type RiskDecisionOutcome = 'APPROVED' | 'REJECTED';

export type RiskDecisionReasonCode =
  | 'KILL_SWITCH_DISABLED'
  | 'INSTRUMENT_NOT_ALLOWED'
  | 'NO_ACTIONABLE_DIRECTION'
  | 'MAX_PROPOSALS_PER_RUN'
  | 'NOTIONAL_EXCEEDS_MAX'
  | 'CONCENTRATION_EXCEEDS_MAX'
  | 'OK';

export interface RiskLimits {
  readonly maxNotional: number;
  readonly maxPositionConcentrationPct: number;
  readonly maxProposalsPerRun: number;
  readonly instrumentAllowlist: readonly string[];
}

export interface RiskEvaluationContext {
  readonly referencePrice: number;
  readonly proposedQuantity: number;
  readonly currentPositionQty: number;
  readonly portfolioNav: number;
  readonly limits: RiskLimits;
}

/** Injetado pelo adapter a partir de `process.env.WR_TRADING_ENABLED`; o núcleo nunca lê `process.env` diretamente. */
export interface RiskPolicyConfig {
  readonly tradingEnabled: boolean;
  readonly policyVersion: string;
}

export interface RiskDecision {
  readonly decisionId: string;
  readonly runId: string;
  readonly requestedBy: string;
  readonly instrumentId: string;
  readonly direction: TradeProposal['direction'];
  readonly outcome: RiskDecisionOutcome;
  readonly reasons: readonly RiskDecisionReasonCode[];
  readonly policyVersion: string;
  readonly proposalJson: string;
  readonly contextJson: string;
  readonly policySnapshotJson: string | null;
  readonly decisionTime: string;
  readonly knowledgeTime: string;
  readonly evaluatedAt: string;
}

/** Payload usado para persistir uma nova `RiskDecision` (identidade sempre gerada no servidor). */
export interface RiskDecisionSubmission {
  readonly runId: string;
  readonly requestedBy: string;
  readonly instrumentId: string;
  readonly direction: TradeProposal['direction'];
  readonly outcome: RiskDecisionOutcome;
  readonly reasons: readonly RiskDecisionReasonCode[];
  readonly policyVersion: string;
  readonly proposalJson: string;
  readonly contextJson: string;
  readonly policySnapshotJson: string | null;
  readonly decisionTime: string;
  readonly knowledgeTime: string;
}

export interface RiskPolicyEvaluationResult {
  readonly outcome: RiskDecisionOutcome;
  readonly reasons: readonly RiskDecisionReasonCode[];
}

/**
 * Núcleo puro do motor de risco (regras 1→7, ordem fixa; a primeira
 * rejeição encerra e registra apenas o código da regra que falhou).
 * `priorDecisionsForRun` é a contagem de `RiskDecision` já persistidos
 * para este `runId` (qualquer `outcome`), fornecida pelo chamador —
 * este núcleo não acessa repositório algum.
 */
export function evaluatePolicy(
  proposal: TradeProposal,
  context: RiskEvaluationContext,
  config: RiskPolicyConfig,
  priorDecisionsForRun: number,
): RiskPolicyEvaluationResult {
  if (!config.tradingEnabled) {
    return { outcome: 'REJECTED', reasons: ['KILL_SWITCH_DISABLED'] };
  }

  if (proposal.direction === 'HOLD') {
    return { outcome: 'APPROVED', reasons: ['NO_ACTIONABLE_DIRECTION'] };
  }

  // Allowlist vazia = sem restrição de instrumento (qualquer ativo que a
  // plataforma consiga cotar via MT5 conectado é elegível) — allowlist
  // não-vazia continua funcionando como trava opcional via env.
  if (
    context.limits.instrumentAllowlist.length > 0 &&
    !context.limits.instrumentAllowlist.includes(proposal.instrumentId)
  ) {
    return { outcome: 'REJECTED', reasons: ['INSTRUMENT_NOT_ALLOWED'] };
  }

  if (priorDecisionsForRun >= context.limits.maxProposalsPerRun) {
    return { outcome: 'REJECTED', reasons: ['MAX_PROPOSALS_PER_RUN'] };
  }

  const notional = context.referencePrice * context.proposedQuantity;
  if (notional > context.limits.maxNotional) {
    return { outcome: 'REJECTED', reasons: ['NOTIONAL_EXCEEDS_MAX'] };
  }

  const postQty =
    proposal.direction === 'BUY'
      ? context.currentPositionQty + context.proposedQuantity
      : Math.max(context.currentPositionQty - context.proposedQuantity, 0);
  const concentrationPct = ((postQty * context.referencePrice) / context.portfolioNav) * 100;
  if (concentrationPct > context.limits.maxPositionConcentrationPct) {
    return { outcome: 'REJECTED', reasons: ['CONCENTRATION_EXCEEDS_MAX'] };
  }

  return { outcome: 'APPROVED', reasons: ['OK'] };
}
