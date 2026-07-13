/**
 * Fase 3 / Item 1 — fundação do runtime assíncrono de agentes (`AgentRun`).
 *
 * `AgentRun` persiste o ciclo de vida de um pedido de análise/pesquisa
 * assíncrono. O agente nunca produz uma ordem executável: a saída
 * (`AgentRunOutput`) é sempre um `ResearchFinding` ou `TradeProposal`,
 * nunca um `OrderIntent`. Aprovação humana é sempre exigida antes de
 * qualquer intenção de execução (fora do escopo deste item).
 */

export type AgentRunKind = 'RESEARCH' | 'PROPOSAL';

export type AgentRunStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

export interface AgentRunDag {
  readonly nodes: readonly string[];
  readonly edges: readonly (readonly [string, string])[];
}

export interface AgentRunBudget {
  readonly maxSteps?: number;
  readonly maxCost?: number;
  readonly timeoutMs?: number;
}

export interface ResearchFinding {
  readonly kind: 'RESEARCH';
  readonly thesis: string;
  readonly evidence: readonly { readonly source: string; readonly reference: string; readonly asOf: string }[];
  readonly risks: readonly string[];
  readonly confidence: number;
  readonly decisionTime: string;
  readonly invalidation: string;
}

export interface TradeProposal {
  readonly kind: 'PROPOSAL';
  readonly instrumentId: string;
  readonly direction: 'BUY' | 'SELL' | 'HOLD';
  readonly rationale: string;
  readonly risks: readonly string[];
  readonly confidence: number;
  readonly decisionTime: string;
  readonly requiresHumanApproval: true;
}

export type AgentRunOutput = ResearchFinding | TradeProposal;

export interface AgentRunError {
  readonly code: string;
  readonly message: string;
}

export interface AgentRun {
  readonly runId: string;
  readonly requestedBy: string;
  readonly kind: AgentRunKind;
  readonly status: AgentRunStatus;
  readonly dag: AgentRunDag;
  readonly input: Record<string, unknown>;
  readonly budget: AgentRunBudget;
  readonly output: AgentRunOutput | null;
  readonly error: AgentRunError | null;
  readonly decisionTime: string;
  readonly knowledgeTime: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly finishedAt: string | null;
}

/** Payload usado para criar um novo `AgentRun` (identidade sempre gerada no servidor). */
export interface AgentRunSubmission {
  readonly requestedBy: string;
  readonly kind: AgentRunKind;
  readonly dag: AgentRunDag;
  readonly input: Record<string, unknown>;
  readonly budget: AgentRunBudget;
  readonly decisionTime: string;
  readonly knowledgeTime: string;
}

const TERMINAL_STATUSES: readonly AgentRunStatus[] = ['SUCCEEDED', 'FAILED', 'CANCELLED'];

/** Transições determinísticas permitidas do ciclo de vida do `AgentRun`. */
const ALLOWED_TRANSITIONS: Readonly<Record<AgentRunStatus, readonly AgentRunStatus[]>> = {
  QUEUED: ['RUNNING', 'CANCELLED'],
  RUNNING: ['SUCCEEDED', 'FAILED', 'CANCELLED'],
  SUCCEEDED: [],
  FAILED: [],
  CANCELLED: [],
};

export function isTerminalStatus(status: AgentRunStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function canTransition(from: AgentRunStatus, to: AgentRunStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}
