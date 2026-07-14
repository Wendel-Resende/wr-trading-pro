import type { RiskDecision as RiskDecisionRow } from '@prisma/client';
import type { RiskDecision, RiskDecisionOutcome, RiskDecisionReasonCode } from '../../../domain/v1/models/risk-policy';
import { RiskDecisionReasonCodeSchema } from './schemas';
import { InvalidRiskPolicyInputError } from './errors';

/** JSON parse/stringify for the RiskDecision physical TEXT columns happens ONLY at this adapter boundary. */
export function parseReasons(raw: string): readonly RiskDecisionReasonCode[] {
  const parsed = safeJsonParse(raw, 'reasonsJson');
  const result = RiskDecisionReasonCodeSchema.array().safeParse(parsed);
  if (!result.success) throw new InvalidRiskPolicyInputError('reasonsJson: formato inválido na linha persistida');
  return result.data;
}

export function stringifyReasons(reasons: readonly RiskDecisionReasonCode[]): string {
  return JSON.stringify(reasons);
}

function safeJsonParse(raw: string, field: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new InvalidRiskPolicyInputError(`${field}: JSON inválido na linha persistida`);
  }
}

export const toRiskDecision = (row: RiskDecisionRow): RiskDecision => ({
  decisionId: row.decisionId,
  runId: row.runId,
  requestedBy: row.requestedBy,
  instrumentId: row.instrumentId,
  direction: row.direction as RiskDecision['direction'],
  outcome: row.outcome as RiskDecisionOutcome,
  reasons: parseReasons(row.reasonsJson),
  policyVersion: row.policyVersion,
  proposalJson: row.proposalJson,
  contextJson: row.contextJson,
  policySnapshotJson: row.policySnapshotJson,
  decisionTime: row.decisionTime.toISOString(),
  knowledgeTime: row.knowledgeTime.toISOString(),
  evaluatedAt: row.evaluatedAt.toISOString(),
});
