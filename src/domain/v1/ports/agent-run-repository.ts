import type { AgentRun, AgentRunNodeStates, AgentRunOutput, AgentRunStatus, AgentRunSubmission } from '../models/agent-run';

export interface AgentRunListQuery {
  readonly requestedBy?: string;
  readonly status?: AgentRunStatus;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Port do runtime assíncrono de agentes (Fase 3 / Item 2). Nenhum método
 * conecta a `ExecutionBroker`/ordens reais; `transitionTo` é o único ponto
 * de mutação de status, e `recordProgress` é o único ponto de mutação de
 * observabilidade do DAG (`nodeStatesJson`/`stepsUsed`/`costUsed`) durante
 * a execução em `RUNNING`.
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
  /** Persiste progresso de execução do DAG sem alterar `status`; exige que o run esteja `RUNNING`. */
  recordProgress(
    runId: string,
    progress: { readonly nodeStates: AgentRunNodeStates; readonly stepsUsed: number; readonly costUsed: number },
  ): Promise<AgentRun>;
}
