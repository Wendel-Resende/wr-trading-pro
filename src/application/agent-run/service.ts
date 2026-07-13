import type { AgentRun, AgentRunBudget, AgentRunDag, AgentRunKind, AgentRunOutput, AgentRunStatus } from '../../domain/v1/models/agent-run';
import type { AgentRunRepository } from '../../domain/v1/ports/agent-run-repository';
import { compareInstants, parseInstant } from '../../domain/v1/time';
import { ReadModelError } from '../read-models-v1/errors';

export interface AgentRunServicePorts {
  readonly agentRunRepository: AgentRunRepository;
}

export interface SubmitAgentRunInputV1 {
  readonly requestedBy: string;
  readonly kind: AgentRunKind;
  readonly dag: AgentRunDag;
  readonly input: Record<string, unknown>;
  readonly budget?: AgentRunBudget;
  readonly decisionTime: string;
}

export interface ListAgentRunsQueryV1 {
  readonly requestedBy?: string;
  readonly status?: AgentRunStatus;
  readonly limit?: number;
  readonly offset?: number;
}

function requireInstant(value: string, field: string): void {
  if (parseInstant(value) === null) {
    throw new ReadModelError('INVALID_QUERY', `${field} inválido: timestamp ISO-8601 exigido`);
  }
}

/** Fixed, deterministic example output contracts (Fase 3 / Item 1 — sem LLM real). */
function buildSimulatedOutput(kind: AgentRunKind, decisionTime: string): AgentRunOutput {
  if (kind === 'RESEARCH') {
    return Object.freeze({
      kind: 'RESEARCH',
      thesis: 'Exemplo determinístico de tese de pesquisa (processamento simulado).',
      evidence: Object.freeze([
        Object.freeze({ source: 'simulated', reference: 'agent-run:v1:example', asOf: decisionTime }),
      ]),
      risks: Object.freeze(['saída simulada; não usar como base de decisão real']),
      confidence: 0.5,
      decisionTime,
      invalidation: 'Invalida-se automaticamente por ser um contrato de exemplo simulado.',
    });
  }
  return Object.freeze({
    kind: 'PROPOSAL',
    instrumentId: 'SIMULATED',
    direction: 'HOLD',
    rationale: 'Exemplo determinístico de proposta (processamento simulado); nunca gera OrderIntent.',
    risks: Object.freeze(['saída simulada; não usar como base de decisão real']),
    confidence: 0.5,
    decisionTime,
    requiresHumanApproval: true,
  });
}

/**
 * Application service for the async agent-run runtime foundation (Fase 3
 * / Item 1). Depends only on the injected AgentRunRepository port — never
 * touches Prisma, an LLM, or ExecutionBroker directly. Processing is
 * simulated/deterministic: `advance` walks QUEUED -> RUNNING -> SUCCEEDED
 * with a fixed example contract, existing solely to exercise the
 * persisted lifecycle without any real agent execution.
 */
export class AgentRunService {
  constructor(private readonly ports: AgentRunServicePorts) {}

  async submit(input: SubmitAgentRunInputV1): Promise<AgentRun> {
    requireInstant(input.decisionTime, 'decisionTime');
    const knowledgeTime = new Date().toISOString();
    if (compareInstants(parseInstant(knowledgeTime)!, parseInstant(input.decisionTime)!) > 0) {
      throw new ReadModelError('INVALID_TIME_RANGE', 'knowledgeTime não pode ser posterior a decisionTime');
    }

    return this.ports.agentRunRepository.create({
      requestedBy: input.requestedBy,
      kind: input.kind,
      dag: input.dag,
      input: input.input,
      budget: input.budget ?? {},
      decisionTime: input.decisionTime,
      knowledgeTime,
    });
  }

  async get(runId: string): Promise<AgentRun> {
    const run = await this.ports.agentRunRepository.findById(runId);
    if (!run) throw new ReadModelError('AGENT_RUN_NOT_FOUND', 'AgentRun não encontrado');
    return run;
  }

  async list(query: ListAgentRunsQueryV1): Promise<readonly AgentRun[]> {
    return this.ports.agentRunRepository.list(query);
  }

  /** Deterministic, no-LLM simulated processing: QUEUED -> RUNNING -> SUCCEEDED with a fixed example contract. */
  async advance(runId: string): Promise<AgentRun> {
    const run = await this.get(runId);
    if (run.status !== 'QUEUED') {
      throw new ReadModelError('INVALID_TRANSITION', `AgentRun não está QUEUED (status atual: ${run.status})`);
    }
    await this.ports.agentRunRepository.transitionTo(runId, 'RUNNING');
    const output = buildSimulatedOutput(run.kind, run.decisionTime);
    return this.ports.agentRunRepository.transitionTo(runId, 'SUCCEEDED', { output });
  }

  async cancel(runId: string): Promise<AgentRun> {
    const run = await this.get(runId);
    if (run.status !== 'QUEUED' && run.status !== 'RUNNING') {
      throw new ReadModelError('INVALID_TRANSITION', `AgentRun não pode ser cancelado (status atual: ${run.status})`);
    }
    return this.ports.agentRunRepository.transitionTo(runId, 'CANCELLED');
  }
}
