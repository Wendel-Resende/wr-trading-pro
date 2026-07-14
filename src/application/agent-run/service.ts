import type {
  AgentRun,
  AgentRunBudget,
  AgentRunDag,
  AgentRunKind,
  AgentRunNode,
  AgentRunNodeState,
  AgentRunNodeStates,
  AgentRunNodeType,
  AgentRunOutput,
  AgentRunStatus,
} from '../../domain/v1/models/agent-run';
import { InvalidAgentRunDagError, validateAndSortDag } from '../../domain/v1/models/agent-run';
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

/** Fixed, deterministic example output contract (Fase 3 — sem LLM real). Montado pelo nó SYNTHESIS. */
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

/** Custo estimado fixo por tipo de nó (orçamento `maxCost`, Item 2). */
function costForNodeType(type: AgentRunNodeType): number {
  switch (type) {
    case 'AGENT':
      return 2;
    case 'EVIDENCE':
    case 'SYNTHESIS':
      return 1;
    default:
      return 0;
  }
}

/** Tempo simulado de processamento por nó, para exercitar `timeoutMs` de forma determinística (sem I/O real). */
const NODE_WORK_MS = 5;

function simulateNodeWork(type: AgentRunNodeType): void {
  if (type === 'INPUT' || type === 'OUTPUT') return;
  const start = Date.now();
  while (Date.now() - start < NODE_WORK_MS) {
    /* busy-wait determinístico: sem dependência de agendamento do event loop */
  }
}

function resolveRef(ref: string, nodeStates: AgentRunNodeStates): unknown {
  const dotIndex = ref.indexOf('.');
  const nodeId = dotIndex === -1 ? ref : ref.slice(0, dotIndex);
  const field = dotIndex === -1 ? undefined : ref.slice(dotIndex + 1);
  const state = nodeStates[nodeId];
  if (!state || !state.output) return undefined;
  return field ? state.output[field] : state.output;
}

/** Execução determinística e simulada (sem LLM real) de um único nó do DAG. */
function executeNode(
  node: AgentRunNode,
  nodeStates: AgentRunNodeStates,
  input: Record<string, unknown>,
  kind: AgentRunKind,
  decisionTime: string,
): Record<string, unknown> {
  switch (node.type) {
    case 'INPUT': {
      const provides = node.provides ?? Object.keys(input);
      const output: Record<string, unknown> = {};
      for (const key of provides) output[key] = input[key];
      return output;
    }
    case 'AGENT': {
      const provides = node.provides ?? ['thesisDraft'];
      const output: Record<string, unknown> = {};
      for (const key of provides) {
        output[key] = `Simulado (role=${node.role ?? node.id}): rascunho determinístico para ${key}`;
      }
      return output;
    }
    case 'EVIDENCE': {
      const provides = node.provides ?? ['evidenceList'];
      const evidenceList = (node.reads ?? []).map((ref, index) => ({
        source: 'simulated',
        reference: `agent-run:v1:node:${index}`,
        asOf: decisionTime,
        value: resolveRef(ref, nodeStates) ?? null,
      }));
      const output: Record<string, unknown> = {};
      for (const key of provides) output[key] = evidenceList;
      return output;
    }
    case 'SYNTHESIS': {
      const provides = node.provides ?? ['finding'];
      const contract = buildSimulatedOutput(kind, decisionTime);
      const output: Record<string, unknown> = {};
      for (const key of provides) output[key] = contract as unknown as Record<string, unknown>;
      return output;
    }
    case 'OUTPUT': {
      const ref = (node.reads ?? [])[0];
      const value = ref ? resolveRef(ref, nodeStates) : undefined;
      return (value ?? {}) as Record<string, unknown>;
    }
    default:
      return {};
  }
}

/**
 * Application service for the async agent-run DAG runtime (Fase 3 / Item
 * 2). Depends only on the injected AgentRunRepository port — never
 * touches Prisma, an LLM, or ExecutionBroker directly. `advance` valida
 * o DAG semântico, executa os nós em ordem topológica determinística
 * (sem LLM real), acumula `nodeStates`/`stepsUsed`/`costUsed`, e aplica
 * orçamento real (`maxSteps`/`maxCost`/`timeoutMs`).
 */
export class AgentRunService {
  constructor(private readonly ports: AgentRunServicePorts) {}

  async submit(input: SubmitAgentRunInputV1): Promise<AgentRun> {
    requireInstant(input.decisionTime, 'decisionTime');
    const knowledgeTime = new Date().toISOString();
    if (compareInstants(parseInstant(knowledgeTime)!, parseInstant(input.decisionTime)!) > 0) {
      throw new ReadModelError('INVALID_TIME_RANGE', 'knowledgeTime não pode ser posterior a decisionTime');
    }

    try {
      validateAndSortDag(input.dag);
    } catch (error) {
      if (error instanceof InvalidAgentRunDagError) {
        throw new ReadModelError('INVALID_DAG', error.message);
      }
      throw error;
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

  /**
   * Executa o DAG em ordem topológica determinística (sem LLM real):
   * QUEUED -> RUNNING -> (SUCCEEDED | FAILED). Orçamento (`maxSteps`,
   * `maxCost`, `timeoutMs`) é aplicado nó a nó; estouro leva a `FAILED`
   * com `errorJson` explícito.
   */
  async advance(runId: string): Promise<AgentRun> {
    const run = await this.get(runId);
    if (run.status !== 'QUEUED') {
      throw new ReadModelError('INVALID_TRANSITION', `AgentRun não está QUEUED (status atual: ${run.status})`);
    }

    let sortedNodes: readonly AgentRunNode[];
    try {
      sortedNodes = validateAndSortDag(run.dag);
    } catch (error) {
      if (error instanceof InvalidAgentRunDagError) {
        throw new ReadModelError('INVALID_DAG', error.message);
      }
      throw error;
    }

    await this.ports.agentRunRepository.transitionTo(runId, 'RUNNING');

    const nodeStates: Record<string, AgentRunNodeState> = {};
    let stepsUsed = 0;
    let costUsed = 0;
    const startedAt = Date.now();
    let finalOutput: AgentRunOutput | null = null;

    for (const node of sortedNodes) {
      const output = executeNode(node, nodeStates, run.input, run.kind, run.decisionTime);
      simulateNodeWork(node.type);

      stepsUsed += 1;
      costUsed += costForNodeType(node.type);
      nodeStates[node.id] = { status: 'DONE', output };
      if (node.type === 'OUTPUT') finalOutput = output as unknown as AgentRunOutput;

      const budget = run.budget;
      const elapsedMs = Date.now() - startedAt;
      const breach =
        budget.maxSteps !== undefined && stepsUsed > budget.maxSteps
          ? { code: 'MAX_STEPS_EXCEEDED', message: `maxSteps excedido: ${stepsUsed} > ${budget.maxSteps}` }
          : budget.maxCost !== undefined && costUsed > budget.maxCost
            ? { code: 'MAX_COST_EXCEEDED', message: `maxCost excedido: ${costUsed} > ${budget.maxCost}` }
            : budget.timeoutMs !== undefined && elapsedMs > budget.timeoutMs
              ? { code: 'TIMEOUT_EXCEEDED', message: `timeoutMs excedido: ${elapsedMs}ms > ${budget.timeoutMs}ms` }
              : null;

      if (breach) {
        nodeStates[node.id] = { status: 'FAILED', output };
        await this.ports.agentRunRepository.recordProgress(runId, { nodeStates, stepsUsed, costUsed });
        return this.ports.agentRunRepository.transitionTo(runId, 'FAILED', { error: breach });
      }

      await this.ports.agentRunRepository.recordProgress(runId, { nodeStates, stepsUsed, costUsed });
    }

    if (!finalOutput) {
      return this.ports.agentRunRepository.transitionTo(runId, 'FAILED', {
        error: { code: 'MISSING_OUTPUT_NODE', message: 'DAG não produziu saída no nó OUTPUT' },
      });
    }

    return this.ports.agentRunRepository.transitionTo(runId, 'SUCCEEDED', { output: finalOutput });
  }

  async cancel(runId: string): Promise<AgentRun> {
    const run = await this.get(runId);
    if (run.status !== 'QUEUED' && run.status !== 'RUNNING') {
      throw new ReadModelError('INVALID_TRANSITION', `AgentRun não pode ser cancelado (status atual: ${run.status})`);
    }
    return this.ports.agentRunRepository.transitionTo(runId, 'CANCELLED');
  }
}
