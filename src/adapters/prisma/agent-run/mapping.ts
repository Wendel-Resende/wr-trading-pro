import type { AgentRun as AgentRunRow } from '@prisma/client';
import type { AgentRun, AgentRunBudget, AgentRunDag, AgentRunError as AgentRunErrorDetail, AgentRunKind, AgentRunNodeStates, AgentRunOutput, AgentRunStatus } from '../../../domain/v1/models/agent-run';
import { AgentRunBudgetSchema, AgentRunDagSchema, AgentRunNodeStatesSchema, AgentRunOutputSchema } from './schemas';
import { InvalidAgentRunInputError } from './errors';

/** JSON parse/stringify for the AgentRun physical TEXT columns happens ONLY at this adapter boundary. */
export function parseDag(raw: string): AgentRunDag {
  const parsed = safeJsonParse(raw, 'dag');
  const result = AgentRunDagSchema.safeParse(parsed);
  if (!result.success) throw new InvalidAgentRunInputError('dag: formato inválido na linha persistida');
  return result.data;
}

export function stringifyDag(dag: AgentRunDag): string {
  return JSON.stringify(dag);
}

export function parseBudget(raw: string): AgentRunBudget {
  const parsed = safeJsonParse(raw, 'budget');
  const result = AgentRunBudgetSchema.safeParse(parsed);
  if (!result.success) throw new InvalidAgentRunInputError('budget: formato inválido na linha persistida');
  return result.data;
}

export function stringifyBudget(budget: AgentRunBudget): string {
  return JSON.stringify(budget);
}

export function parseInput(raw: string): Record<string, unknown> {
  const parsed = safeJsonParse(raw, 'input');
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new InvalidAgentRunInputError('input: formato inválido na linha persistida');
  }
  return parsed as Record<string, unknown>;
}

export function stringifyInput(input: Record<string, unknown>): string {
  return JSON.stringify(input);
}

export function parseOutput(raw: string): AgentRunOutput {
  const parsed = safeJsonParse(raw, 'output');
  const result = AgentRunOutputSchema.safeParse(parsed);
  if (!result.success) throw new InvalidAgentRunInputError('output: formato inválido na linha persistida');
  return result.data;
}

export function stringifyOutput(output: AgentRunOutput): string {
  return JSON.stringify(output);
}

export function parseErrorDetail(raw: string): AgentRunErrorDetail {
  const parsed = safeJsonParse(raw, 'error');
  if (
    typeof parsed !== 'object' || parsed === null
    || typeof (parsed as Record<string, unknown>).code !== 'string'
    || typeof (parsed as Record<string, unknown>).message !== 'string'
  ) {
    throw new InvalidAgentRunInputError('error: formato inválido na linha persistida');
  }
  return parsed as AgentRunErrorDetail;
}

export function stringifyErrorDetail(error: AgentRunErrorDetail): string {
  return JSON.stringify(error);
}

export function parseNodeStates(raw: string): AgentRunNodeStates {
  const parsed = safeJsonParse(raw, 'nodeStatesJson');
  const result = AgentRunNodeStatesSchema.safeParse(parsed);
  if (!result.success) throw new InvalidAgentRunInputError('nodeStatesJson: formato inválido na linha persistida');
  return result.data;
}

export function stringifyNodeStates(nodeStates: AgentRunNodeStates): string {
  return JSON.stringify(nodeStates);
}

function safeJsonParse(raw: string, field: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new InvalidAgentRunInputError(`${field}: JSON inválido na linha persistida`);
  }
}

export const toAgentRun = (row: AgentRunRow): AgentRun => ({
  runId: row.runId,
  requestedBy: row.requestedBy,
  kind: row.kind as AgentRunKind,
  status: row.status as AgentRunStatus,
  dag: parseDag(row.dag),
  input: parseInput(row.inputJson),
  budget: parseBudget(row.budgetJson),
  output: row.outputJson !== null ? parseOutput(row.outputJson) : null,
  error: row.errorJson !== null ? parseErrorDetail(row.errorJson) : null,
  nodeStates: row.nodeStatesJson !== null ? parseNodeStates(row.nodeStatesJson) : {},
  stepsUsed: row.stepsUsed,
  costUsed: row.costUsed,
  decisionTime: row.decisionTime.toISOString(),
  knowledgeTime: row.knowledgeTime.toISOString(),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  finishedAt: row.finishedAt !== null ? row.finishedAt.toISOString() : null,
});
