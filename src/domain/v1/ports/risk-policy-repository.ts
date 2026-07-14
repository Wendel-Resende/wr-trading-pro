import type { RiskDecision, RiskDecisionSubmission } from '../models/risk-policy';

/**
 * Port do ledger de auditoria `RiskDecision` (Fase 3 / Item 3). Toda
 * avaliação do motor de risco é persistida aqui; não há mutação além de
 * `saveDecision` (o ledger é apend-only, nunca atualizado).
 */
export interface RiskPolicyRepository {
  saveDecision(submission: RiskDecisionSubmission): Promise<RiskDecision>;
  countByRunId(runId: string): Promise<number>;
  findByDecisionId(decisionId: string): Promise<RiskDecision | null>;
  findByRunId(runId: string): Promise<readonly RiskDecision[]>;
}
