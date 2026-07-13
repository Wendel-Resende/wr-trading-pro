import type { AgentRun, AgentRunOutput, AgentRunStatus, AgentRunSubmission } from '../models/agent-run';

export interface AgentRunListQuery {
  readonly requestedBy?: string;
  readonly status?: AgentRunStatus;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Port do runtime assíncrono de agentes (Fase 3 / Item 1). Nenhum método
 * conecta a `ExecutionBroker`/ordens reais; `transitionTo` é o único ponto
 * de mutação de estado, e é usado tanto pelo processamento simulado
 * quanto pelo cancelamento.
 */
export interface AgentRunRepository {
  create(submission: AgentRunSubmission): Promise<AgentRun>;
  findById(runId: string): Promise<AgentRun | null>;
  list(query: AgentRunListQuery): Promise<readonly AgentRun[]>;
  transitionTo(
    runId: string,
    status: AgentRunStatus,
    detail?: { readonly output?: AgentRunOutput; readonly error?: { readonly code: string; readonly message: string } },
  ): Promise<AgentRun>;
}
