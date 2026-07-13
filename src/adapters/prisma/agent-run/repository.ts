import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { canTransition } from '../../../domain/v1/models/agent-run';
import type { AgentRun, AgentRunOutput, AgentRunStatus, AgentRunSubmission } from '../../../domain/v1/models/agent-run';
import type { AgentRunListQuery, AgentRunRepository } from '../../../domain/v1/ports/agent-run-repository';
import { toAgentRun, stringifyBudget, stringifyDag, stringifyErrorDetail, stringifyInput, stringifyOutput } from './mapping';
import { AgentRunListQuerySchema, AgentRunSubmissionSchema } from './schemas';
import { AgentRunNotFoundError, InvalidAgentRunTransitionError } from './errors';

/**
 * Prisma implementation of AgentRunRepository (Fase 3 / Item 1). `runId`
 * is always generated server-side (`randomUUID()`), never accepted from
 * the caller. `transitionTo` is the only mutation entry point and
 * enforces the deterministic state machine from the domain model
 * (`canTransition`) — no direct status write exists anywhere else.
 */
export class PrismaAgentRunRepository implements AgentRunRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(submission: AgentRunSubmission): Promise<AgentRun> {
    const normalized = AgentRunSubmissionSchema.parse(submission);
    const runId = randomUUID();

    const row = await this.prisma.agentRun.create({
      data: {
        runId,
        requestedBy: normalized.requestedBy,
        kind: normalized.kind,
        status: 'QUEUED',
        dag: stringifyDag(normalized.dag),
        inputJson: stringifyInput(normalized.input),
        budgetJson: stringifyBudget(normalized.budget),
        decisionTime: new Date(normalized.decisionTime),
        knowledgeTime: new Date(normalized.knowledgeTime),
      },
    });

    return toAgentRun(row);
  }

  async findById(runId: string): Promise<AgentRun | null> {
    const row = await this.prisma.agentRun.findUnique({ where: { runId } });
    return row ? toAgentRun(row) : null;
  }

  async list(query: AgentRunListQuery): Promise<readonly AgentRun[]> {
    const normalized = AgentRunListQuerySchema.parse(query);
    const rows = await this.prisma.agentRun.findMany({
      where: {
        ...(normalized.requestedBy ? { requestedBy: normalized.requestedBy } : {}),
        ...(normalized.status ? { status: normalized.status } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: normalized.limit,
      skip: normalized.offset,
    });
    return Object.freeze(rows.map(toAgentRun));
  }

  async transitionTo(
    runId: string,
    status: AgentRunStatus,
    detail?: { readonly output?: AgentRunOutput; readonly error?: { readonly code: string; readonly message: string } },
  ): Promise<AgentRun> {
    const existing = await this.prisma.agentRun.findUnique({ where: { runId } });
    if (!existing) throw new AgentRunNotFoundError(`AgentRun não encontrado: ${runId}`);

    const currentStatus = existing.status as AgentRunStatus;
    if (!canTransition(currentStatus, status)) {
      throw new InvalidAgentRunTransitionError(`transição inválida: ${currentStatus} -> ${status}`);
    }

    const isTerminal = status === 'SUCCEEDED' || status === 'FAILED' || status === 'CANCELLED';

    const row = await this.prisma.agentRun.update({
      where: { runId },
      data: {
        status,
        outputJson: status === 'SUCCEEDED' && detail?.output ? stringifyOutput(detail.output) : undefined,
        errorJson: status === 'FAILED' && detail?.error ? stringifyErrorDetail(detail.error) : undefined,
        finishedAt: isTerminal ? new Date() : undefined,
      },
    });

    return toAgentRun(row);
  }
}
