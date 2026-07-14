/**
 * `agent_run.get`, `risk_decision.get`, `order_intent.get` (Fase 4,
 * catálogo seção 4.2). Somente leitura: cada tool chama exclusivamente
 * `get*`/`list*` da facade `McpReadServices` — nunca `submit`,
 * `advance`, `cancel`, `evaluate` ou `create`.
 */
import { z } from 'zod';
import { ReadModelError } from '../../application/read-models-v1/errors';
import type { McpReadServices } from '../ports/mcp-read-service';
import { parseToolArgs, toToolError, type McpToolDefinition } from './registry-types';

const agentRunStatus = z.enum(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED']);
const riskOutcome = z.enum(['APPROVED', 'REJECTED']);
const orderIntentStatus = z.enum(['CREATED', 'CANCELLED']);

const agentRunGetShape = {
  runId: z.string().min(1).optional(),
  status: agentRunStatus.optional(),
  limit: z.number().int().min(1).optional(),
  offset: z.number().int().min(0).optional(),
};

const riskDecisionGetShape = {
  decisionId: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  outcome: riskOutcome.optional(),
  limit: z.number().int().min(1).optional(),
};

const orderIntentGetShape = {
  intentId: z.string().min(1).optional(),
  decisionId: z.string().min(1).optional(),
  status: orderIntentStatus.optional(),
  limit: z.number().int().min(1).optional(),
};

export function buildRuntimeTools(services: McpReadServices): readonly McpToolDefinition[] {
  return [
    {
      name: 'agent_run.get',
      description: 'AgentRun por runId, ou lista filtrada por status/limit/offset. Somente leitura.',
      inputSchema: agentRunGetShape,
      handler: async (args) => {
        try {
          const query = parseToolArgs(agentRunGetShape, args);
          if (query.runId) {
            const result = await services.agentRun.get(query.runId);
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
          }
          const result = await services.agentRun.list({
            status: query.status,
            limit: query.limit,
            offset: query.offset,
          });
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        } catch (error) {
          return toToolError(error);
        }
      },
    },
    {
      name: 'risk_decision.get',
      description: 'RiskDecision por decisionId, ou lista por runId. Somente leitura.',
      inputSchema: riskDecisionGetShape,
      handler: async (args) => {
        try {
          const query = parseToolArgs(riskDecisionGetShape, args);
          if (query.decisionId) {
            const result = await services.riskDecision.getDecision(query.decisionId);
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
          }
          if (!query.runId) {
            return toToolError(new ReadModelError('INVALID_QUERY', 'runId ou decisionId é obrigatório'));
          }
          let result = await services.riskDecision.listByRunId(query.runId);
          if (query.outcome) result = result.filter((decision) => decision.outcome === query.outcome);
          if (typeof query.limit === 'number') result = result.slice(0, query.limit);
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        } catch (error) {
          return toToolError(error);
        }
      },
    },
    {
      name: 'order_intent.get',
      description: 'OrderIntent por intentId, ou lista por decisionId. Somente leitura — não cria/cancela intenção.',
      inputSchema: orderIntentGetShape,
      handler: async (args) => {
        try {
          const query = parseToolArgs(orderIntentGetShape, args);
          if (query.intentId) {
            const result = await services.orderIntent.getIntent(query.intentId);
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
          }
          if (!query.decisionId) {
            return toToolError(new ReadModelError('INVALID_QUERY', 'decisionId ou intentId é obrigatório'));
          }
          let result = await services.orderIntent.listByDecisionId(query.decisionId);
          if (query.status) result = result.filter((intent) => intent.status === query.status);
          if (typeof query.limit === 'number') result = result.slice(0, query.limit);
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        } catch (error) {
          return toToolError(error);
        }
      },
    },
  ];
}
