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
  // Gate de significância estatística (2026-09-06). Quatro códigos e não
  // um só porque "recusado por evidência" tem quatro causas distintas, e
  // juntá-las esconderia qual delas o agente precisa corrigir.
  | 'EVIDENCE_MISSING'
  | 'EVIDENCE_INCONCLUSIVE'
  | 'EVIDENCE_PVALUE_ABOVE_MAX'
  | 'EVIDENCE_STALE'
  | 'OK';

export interface RiskLimits {
  readonly maxNotional: number;
  readonly maxPositionConcentrationPct: number;
  readonly maxProposalsPerRun: number;
  readonly instrumentAllowlist: readonly string[];
  /**
   * P-valor máximo aceito da sessão de significância citada pela proposta.
   * `null` = gate DESLIGADO: nem exige evidência, nem a examina. É esse
   * default que mantém as chamadas existentes funcionando antes de
   * `WR_MCP_TRADE_MAX_PVALUE` ser setada.
   */
  readonly maxPValue: number | null;
  /**
   * Validade da evidência, em dias. `null` = sem validade. Existe porque
   * sem prazo uma sessão de meses atrás autorizaria o trade de hoje — o
   * mesmo casamento frouxo que se evitou ao exigir a citação explícita.
   */
  readonly evidenceMaxAgeDays: number | null;
}

/**
 * Fato reduzido da sessão de pesquisa citada pela proposta. O serviço
 * busca a `ResearchSession` no banco e a achata nisto; o núcleo puro
 * decide sobre o fato e nunca toca repositório.
 *
 * `null` em `RiskEvaluationContext.evidence` significa "nenhuma sessão
 * citada", que é distinto de "sessão citada e ruim".
 */
export interface RiskEvidence {
  readonly sessionId: string;
  readonly kind: string;
  readonly status: string;
  /** `null` quando a sessão terminou com `insufficientData`. */
  readonly pValue: number | null;
  readonly insufficientData: boolean;
  readonly ageDays: number;
}

export interface RiskEvaluationContext {
  readonly referencePrice: number;
  readonly proposedQuantity: number;
  readonly currentPositionQty: number;
  readonly portfolioNav: number;
  readonly limits: RiskLimits;
  readonly evidence: RiskEvidence | null;
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
 * Regra de evidência, isolada porque tem quatro saídas e embuti-la no
 * `evaluatePolicy` esconderia a ordem entre elas. Devolve o código da
 * rejeição, ou `null` quando a evidência satisfaz o gate — ou quando o
 * gate está desligado.
 *
 * A ordem interna importa: uma sessão citada que não é do tipo certo, ou
 * que não concluiu, é tratada como AUSENTE (`EVIDENCE_MISSING`), não como
 * evidência ruim. Ela não é uma medição fraca; ela não é uma medição.
 * `EVIDENCE_INCONCLUSIVE` fica reservado para o caso real de a sessão ter
 * rodado e o dado não ter bastado (`pValue: null` abaixo do piso de
 * observações) — e ele REJEITA, porque dado insuficiente não é evidência.
 */
function evaluateEvidence(
  limits: RiskLimits,
  evidence: RiskEvidence | null,
): Exclude<RiskDecisionReasonCode, 'OK'> | null {
  if (limits.maxPValue === null) return null;

  if (evidence === null || evidence.kind !== 'SIGNIFICANCE' || evidence.status !== 'DONE') {
    return 'EVIDENCE_MISSING';
  }

  if (evidence.insufficientData || evidence.pValue === null) {
    return 'EVIDENCE_INCONCLUSIVE';
  }

  if (limits.evidenceMaxAgeDays !== null && evidence.ageDays > limits.evidenceMaxAgeDays) {
    return 'EVIDENCE_STALE';
  }

  // Fronteira inclusiva: p igual ao limiar passa. `0.05` é "p ≤ 0,05".
  if (evidence.pValue > limits.maxPValue) {
    return 'EVIDENCE_PVALUE_ABOVE_MAX';
  }

  return null;
}

/**
 * Núcleo puro do motor de risco (regras 1→8, ordem fixa; a primeira
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

  // Gate de significância antes das regras de TAMANHO, de propósito: se a
  // regra não tem evidência de poder preditivo, o tamanho da posição é
  // irrelevante, e "EVIDENCE_MISSING" é a mensagem acionável. Depois do
  // kill switch e da allowlist, que são condições mais fundamentais.
  const evidenceRejection = evaluateEvidence(context.limits, context.evidence);
  if (evidenceRejection !== null) {
    return { outcome: 'REJECTED', reasons: [evidenceRejection] };
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
