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
import type { AgentLlmPort } from '../../domain/v1/ports/agent-llm';
import { compareInstants, parseInstant } from '../../domain/v1/time';
import { ReadModelError } from '../read-models-v1/errors';
import { buildPromptContext } from '../../lib/agent-data-context';

export interface AgentRunServicePorts {
  readonly agentRunRepository: AgentRunRepository;
  /**
   * Porta LLM opcional para os nós AGENT/SYNTHESIS. Ausente (testes,
   * submit/get/list/cancel) ou indisponível em runtime, o processamento cai
   * para o caminho determinístico simulado — sempre marcado como simulado
   * nos nodeStates, nunca apresentado como análise real.
   */
  readonly agentLlm?: AgentLlmPort;
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

/**
 * Validação estrutural do contrato de saída (ResearchFinding/TradeProposal)
 * sem depender do adapter: garante que o que vai para SUCCEEDED é relegível.
 */
function isContractualOutput(output: AgentRunOutput, kind: AgentRunKind): boolean {
  if (typeof output !== 'object' || output === null) return false;
  const o = output as unknown as Record<string, unknown>;
  if (o.kind !== kind) return false;
  if (typeof o.confidence !== 'number' || typeof o.decisionTime !== 'string') return false;
  if (!Array.isArray(o.risks)) return false;
  if (kind === 'RESEARCH') {
    return typeof o.thesis === 'string' && Array.isArray(o.evidence) && typeof o.invalidation === 'string';
  }
  return (
    typeof o.instrumentId === 'string'
    && typeof o.rationale === 'string'
    && (o.direction === 'BUY' || o.direction === 'SELL' || o.direction === 'HOLD')
    && o.requiresHumanApproval === true
  );
}

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

// ---------------------------------------------------------------------------
// Sanitização de conteúdo vindo do LLM: o modelo fornece CONTEÚDO; a
// ESTRUTURA do contrato é sempre montada aqui, campo a campo (schemas de
// persistência são strict — nada fora do contrato pode ser gravado).
// ---------------------------------------------------------------------------

function cleanText(value: unknown, maxLength: number, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (trimmed.length === 0) return fallback;
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1)}…` : trimmed;
}

function cleanRisks(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((r): r is string => typeof r === 'string' && r.trim().length > 0)
    .slice(0, 10)
    .map((r) => cleanText(r, 500, ''));
}

function clamp01(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

/** Extrai o primeiro objeto JSON de um texto de LLM (tolerante a prosa/cercas em volta). */
function extractJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  for (let end = text.length; end > start; end--) {
    if (text[end - 1] !== '}') continue;
    try {
      const parsed = JSON.parse(text.slice(start, end));
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* tenta um fechamento anterior */
    }
  }
  return null;
}

/** Metadata de execução gravada no nodeState (formato livre) — NUNCA no output final (strict). */
interface NodeLlmMeta {
  readonly simulated: boolean;
  readonly provider?: string;
  readonly model?: string;
  readonly totalTokens?: number;
  readonly reason?: string;
}

interface NodeExecution {
  readonly output: Record<string, unknown>;
  readonly cost: number;
}

/**
 * Preferência de provedor/modelo vinda do input do run (auditável na linha
 * persistida). Sanitizada aqui; provedores/modelos inválidos são ignorados
 * pelo adapter, caindo no fallback do proxy.
 */
function llmPreferences(input: Record<string, unknown>): { provider?: string; model?: string } {
  const provider = typeof input.llmProvider === 'string' && input.llmProvider.length <= 20 ? input.llmProvider : undefined;
  const model = typeof input.llmModel === 'string' && input.llmModel.length <= 64 ? input.llmModel : undefined;
  return { provider, model };
}

function simulatedAgentOutput(node: AgentRunNode, reason: string): Record<string, unknown> {
  const provides = node.provides ?? ['thesisDraft'];
  const output: Record<string, unknown> = {};
  for (const key of provides) {
    output[key] = `Simulado (role=${node.role ?? node.id}): rascunho determinístico para ${key}`;
  }
  output._llm = { simulated: true, reason } satisfies NodeLlmMeta;
  return output;
}

function collectAgentMaterial(nodeStates: AgentRunNodeStates): { texts: string[]; liveNodeIds: string[]; providers: Set<string> } {
  const texts: string[] = [];
  const liveNodeIds: string[] = [];
  const providers = new Set<string>();
  for (const [nodeId, state] of Object.entries(nodeStates)) {
    const out = state.output;
    if (!out) continue;
    const meta = out._llm as NodeLlmMeta | undefined;
    for (const [key, value] of Object.entries(out)) {
      if (key === '_llm' || typeof value !== 'string' || value.trim().length === 0) continue;
      texts.push(`[${nodeId}.${key}] ${value}`);
    }
    if (meta && meta.simulated === false) {
      liveNodeIds.push(nodeId);
      if (meta.provider) providers.add(meta.provider);
    }
  }
  return { texts, liveNodeIds, providers };
}

async function executeAgentNodeLive(
  node: AgentRunNode,
  nodeStates: AgentRunNodeStates,
  input: Record<string, unknown>,
  kind: AgentRunKind,
  llm: AgentLlmPort,
): Promise<NodeExecution> {
  const readContext = (node.reads ?? [])
    .map((ref) => `- ${ref}: ${JSON.stringify(resolveRef(ref, nodeStates) ?? null)}`)
    .join('\n');

  // Contexto de dados da plataforma (fundamentos, dividendos, carteira)
  const tickerHint = typeof input.ticker === 'string' ? input.ticker : typeof input.symbol === 'string' ? input.symbol : undefined;
  const dataContext = buildPromptContext(tickerHint);

  const system =
    `Você é o agente "${node.role ?? node.id}" do runtime governado da WR Trading Pro (B3/Brasil). ` +
    `Objetivo do run: ${kind === 'RESEARCH' ? 'pesquisa/análise' : 'avaliação de proposta (nunca execução)'}. ` +
    'Responda em português, de forma objetiva e fundamentada. Você não executa ordens e não tem autoridade de execução.\n\n' +
    `DADOS DA PLATAFORMA (contexto real, use estes dados na sua análise):\n${dataContext}`;
  const user =
    `Contexto de entrada (JSON): ${JSON.stringify(input)}\n` +
    (readContext ? `Saídas de nós anteriores:\n${readContext}\n` : '') +
    'Produza sua análise em texto corrido (sem JSON). Use os dados da plataforma fornecidos no system prompt como base factual.';

  try {
    const completion = await llm.complete(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      llmPreferences(input)
    );
    const provides = node.provides ?? ['thesisDraft'];
    const output: Record<string, unknown> = {};
    for (const key of provides) output[key] = completion.content;
    output._llm = {
      simulated: false,
      provider: completion.provider,
      model: completion.model,
      totalTokens: completion.totalTokens,
    } satisfies NodeLlmMeta;
    return { output, cost: completion.totalTokens };
  } catch (error) {
    const reason = `LLM indisponível: ${error instanceof Error ? error.message : 'erro desconhecido'}`;
    return { output: simulatedAgentOutput(node, reason), cost: costForNodeType(node.type) };
  }
}

async function synthesizeOutputLive(
  nodeStates: AgentRunNodeStates,
  input: Record<string, unknown>,
  kind: AgentRunKind,
  decisionTime: string,
  llm: AgentLlmPort,
): Promise<{ contract: AgentRunOutput; meta: NodeLlmMeta; cost: number }> {
  const material = collectAgentMaterial(nodeStates);
  const sourceLabel = material.providers.size > 0 ? `llm:${Array.from(material.providers).join(',')}` : 'simulated';
  const evidence = Object.freeze(
    (material.liveNodeIds.length > 0 ? material.liveNodeIds : ['simulated']).map((nodeId) =>
      Object.freeze({ source: sourceLabel, reference: `agent-run:v1:node:${nodeId}`, asOf: decisionTime })
    )
  );

  // Contrato determinístico com o material real dos agentes — usado quando a
  // síntese estruturada falha, para nunca perder a análise já produzida.
  const fallbackFromMaterial = (): AgentRunOutput => {
    const joined = material.texts.join('\n\n');
    if (kind === 'RESEARCH') {
      return Object.freeze({
        kind: 'RESEARCH',
        thesis: cleanText(joined, 4000, 'Análise indisponível.'),
        evidence,
        risks: Object.freeze(['síntese estruturada indisponível; tese montada a partir do texto bruto dos agentes']),
        confidence: 0.3,
        decisionTime,
        invalidation: 'condições de invalidação não especificadas pelo agente',
      });
    }
    return Object.freeze({
      kind: 'PROPOSAL',
      instrumentId: cleanText(input.symbol ?? input.ticker ?? input.instrumentId, 30, 'UNSPECIFIED'),
      direction: 'HOLD',
      rationale: cleanText(joined, 4000, 'Análise indisponível.'),
      risks: Object.freeze(['síntese estruturada indisponível; proposta conservadora (HOLD) montada do texto bruto']),
      confidence: 0.3,
      decisionTime,
      requiresHumanApproval: true,
    });
  };

  if (material.liveNodeIds.length === 0) {
    // Nenhum agente rodou com LLM real — não há o que sintetizar de verdade.
    return { contract: buildSimulatedOutput(kind, decisionTime), meta: { simulated: true, reason: 'nenhum nó AGENT executou com LLM real' }, cost: costForNodeType('SYNTHESIS') };
  }

  const schemaHint =
    kind === 'RESEARCH'
      ? '{"thesis": "tese principal", "risks": ["risco 1"], "confidence": 0.0 a 1.0, "invalidation": "o que invalidaria a tese"}'
      : '{"direction": "BUY"|"SELL"|"HOLD", "rationale": "justificativa", "risks": ["risco 1"], "confidence": 0.0 a 1.0, "instrumentId": "ticker"}';

  try {
    const completion = await llm.complete(
      [
        {
          role: 'system',
          content:
            'Você sintetiza análises de agentes da WR Trading Pro em um contrato estruturado. ' +
            `Responda APENAS com um objeto JSON no formato: ${schemaHint}. Sem texto fora do JSON. ` +
            'Use os dados da plataforma como base factual quando relevante.',
        },
        { role: 'user', content: `Análises dos agentes:\n${material.texts.join('\n\n')}\n\nDados da plataforma (referência):\n${buildPromptContext()}` },
      ],
      llmPreferences(input)
    );

    const parsed = extractJsonObject(completion.content);
    const meta: NodeLlmMeta = {
      simulated: false,
      provider: completion.provider,
      model: completion.model,
      totalTokens: completion.totalTokens,
    };

    if (!parsed) return { contract: fallbackFromMaterial(), meta, cost: completion.totalTokens };

    if (kind === 'RESEARCH') {
      const contract: AgentRunOutput = Object.freeze({
        kind: 'RESEARCH',
        thesis: cleanText(parsed.thesis, 4000, cleanText(material.texts.join('\n\n'), 4000, 'Análise indisponível.')),
        evidence,
        risks: Object.freeze(cleanRisks(parsed.risks)),
        confidence: clamp01(parsed.confidence, 0.5),
        decisionTime,
        invalidation: cleanText(parsed.invalidation, 1000, 'condições de invalidação não especificadas pelo agente'),
      });
      return { contract, meta, cost: completion.totalTokens };
    }

    const direction = parsed.direction === 'BUY' || parsed.direction === 'SELL' || parsed.direction === 'HOLD' ? parsed.direction : 'HOLD';
    const contract: AgentRunOutput = Object.freeze({
      kind: 'PROPOSAL',
      instrumentId: cleanText(parsed.instrumentId ?? input.symbol ?? input.ticker, 30, 'UNSPECIFIED'),
      direction,
      rationale: cleanText(parsed.rationale, 4000, 'justificativa não fornecida pelo agente'),
      risks: Object.freeze(cleanRisks(parsed.risks)),
      confidence: clamp01(parsed.confidence, 0.5),
      decisionTime,
      requiresHumanApproval: true,
    });
    return { contract, meta, cost: completion.totalTokens };
  } catch (error) {
    const reason = `síntese LLM indisponível: ${error instanceof Error ? error.message : 'erro desconhecido'}`;
    return { contract: fallbackFromMaterial(), meta: { simulated: false, reason, provider: sourceLabel }, cost: costForNodeType('SYNTHESIS') };
  }
}

/**
 * Execução de um único nó do DAG. Com a porta LLM presente, os nós AGENT e
 * SYNTHESIS usam o provedor real (custo em tokens no costUsed); sem porta ou
 * com provedores indisponíveis, cai para o caminho determinístico simulado —
 * sempre marcado como tal via `_llm` no nodeState.
 */
async function executeNode(
  node: AgentRunNode,
  nodeStates: AgentRunNodeStates,
  input: Record<string, unknown>,
  kind: AgentRunKind,
  decisionTime: string,
  llm: AgentLlmPort | undefined,
): Promise<NodeExecution> {
  switch (node.type) {
    case 'INPUT': {
      const provides = node.provides ?? Object.keys(input);
      const output: Record<string, unknown> = {};
      for (const key of provides) output[key] = input[key];
      return { output, cost: costForNodeType(node.type) };
    }
    case 'AGENT': {
      if (llm) return executeAgentNodeLive(node, nodeStates, input, kind, llm);
      return { output: simulatedAgentOutput(node, 'porta LLM não configurada'), cost: costForNodeType(node.type) };
    }
    case 'EVIDENCE': {
      const provides = node.provides ?? ['evidenceList'];
      const evidenceList = (node.reads ?? []).map((ref, index) => ({
        source: llm ? 'agent-run' : 'simulated',
        reference: `agent-run:v1:node:${index}`,
        asOf: decisionTime,
        value: resolveRef(ref, nodeStates) ?? null,
      }));
      const output: Record<string, unknown> = {};
      for (const key of provides) output[key] = evidenceList;
      return { output, cost: costForNodeType(node.type) };
    }
    case 'SYNTHESIS': {
      const provides = node.provides ?? ['finding'];
      if (llm) {
        const { contract, meta, cost } = await synthesizeOutputLive(nodeStates, input, kind, decisionTime, llm);
        const output: Record<string, unknown> = {};
        for (const key of provides) output[key] = contract as unknown as Record<string, unknown>;
        output._llm = meta;
        return { output, cost };
      }
      const contract = buildSimulatedOutput(kind, decisionTime);
      const output: Record<string, unknown> = {};
      for (const key of provides) output[key] = contract as unknown as Record<string, unknown>;
      output._llm = { simulated: true, reason: 'porta LLM não configurada' } satisfies NodeLlmMeta;
      return { output, cost: costForNodeType(node.type) };
    }
    case 'OUTPUT': {
      const ref = (node.reads ?? [])[0];
      const value = ref ? resolveRef(ref, nodeStates) : undefined;
      if (value !== undefined && value !== null) {
        return { output: value as Record<string, unknown>, cost: costForNodeType(node.type) };
      }
      // Sem `reads` (opcionais no schema) ou referência não resolvida: usa o
      // primeiro contrato válido produzido por um nó SYNTHESIS; em último
      // caso, o contrato simulado — nunca `{}`, que seria persistido e
      // rejeitado pelo mapping na releitura (run ilegível, get/list quebrados).
      for (const state of Object.values(nodeStates)) {
        for (const [key, candidate] of Object.entries(state.output ?? {})) {
          if (key === '_llm') continue;
          if (isContractualOutput(candidate as AgentRunOutput, kind)) {
            return { output: candidate as Record<string, unknown>, cost: costForNodeType(node.type) };
          }
        }
      }
      return {
        output: buildSimulatedOutput(kind, decisionTime) as unknown as Record<string, unknown>,
        cost: costForNodeType(node.type),
      };
    }
    default:
      return { output: {}, cost: costForNodeType(node.type) };
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
      const execution = await executeNode(node, nodeStates, run.input, run.kind, run.decisionTime, this.ports.agentLlm);
      const output = execution.output;
      if (!this.ports.agentLlm) simulateNodeWork(node.type);

      stepsUsed += 1;
      // Com LLM real, o custo do nó são os tokens consumidos na chamada;
      // no caminho simulado, o custo determinístico por tipo de nó.
      costUsed += execution.cost;
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

    // Fail-closed sem envenenar a linha: um output fora do contrato
    // (ResearchFinding/TradeProposal) seria persistido e depois rejeitado
    // pelo mapping em toda leitura — o run ficaria ilegível e derrubaria
    // get/list. Melhor falhar aqui com erro explícito e linha legível.
    if (!isContractualOutput(finalOutput, run.kind)) {
      return this.ports.agentRunRepository.transitionTo(runId, 'FAILED', {
        error: {
          code: 'INVALID_OUTPUT_CONTRACT',
          message: 'nó OUTPUT produziu valor fora do contrato ResearchFinding/TradeProposal',
        },
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
