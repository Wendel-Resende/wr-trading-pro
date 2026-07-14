import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { RiskDecision, RiskDecisionSubmission } from '../../../domain/v1/models/risk-policy';
import type { RiskPolicyRepository } from '../../../domain/v1/ports/risk-policy-repository';
import { toRiskDecision, stringifyReasons } from './mapping';

/**
 * Prisma implementation of RiskPolicyRepository (Fase 3 / Item 3).
 * `decisionId` is always generated server-side (`randomUUID()`), never
 * accepted from the caller. The ledger is append-only: no update/delete
 * method exists on this port.
 */
export class PrismaRiskPolicyRepository implements RiskPolicyRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async saveDecision(submission: RiskDecisionSubmission): Promise<RiskDecision> {
    const decisionId = randomUUID();

    const row = await this.prisma.riskDecision.create({
      data: {
        decisionId,
        runId: submission.runId,
        requestedBy: submission.requestedBy,
        instrumentId: submission.instrumentId,
        direction: submission.direction,
        outcome: submission.outcome,
        reasonsJson: stringifyReasons(submission.reasons),
        policyVersion: submission.policyVersion,
        proposalJson: submission.proposalJson,
        contextJson: submission.contextJson,
        policySnapshotJson: submission.policySnapshotJson,
        decisionTime: new Date(submission.decisionTime),
        knowledgeTime: new Date(submission.knowledgeTime),
      },
    });

    return toRiskDecision(row);
  }

  async countByRunId(runId: string): Promise<number> {
    return this.prisma.riskDecision.count({ where: { runId } });
  }

  async findByDecisionId(decisionId: string): Promise<RiskDecision | null> {
    const row = await this.prisma.riskDecision.findUnique({ where: { decisionId } });
    return row ? toRiskDecision(row) : null;
  }

  async findByRunId(runId: string): Promise<readonly RiskDecision[]> {
    const rows = await this.prisma.riskDecision.findMany({
      where: { runId },
      orderBy: [{ evaluatedAt: 'asc' }, { id: 'asc' }],
    });
    return Object.freeze(rows.map(toRiskDecision));
  }
}
