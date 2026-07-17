/**
 * Tools proxy de ações de agent-run — `submit`/`advance`/`cancel`/`list`
 * sobre `/api/v1/agent-runs*`. `agent_run.submit` monta o corpo com o
 * mesmo shape de `AgentRunsPanel.submit()`: DAG do template (SIMPLES 1
 * agente / COMITE 4 papéis + gestor — ver `agent-dags.ts`), budget por
 * template e `decisionTime = now + 60s` (margem de clock cliente/servidor).
 * Para COMITE, o ticker é validado ANTES de qualquer chamada HTTP (mesmo
 * regex do painel) — nunca deixamos um ticker inválido virar prompt de LLM.
 */
import { z } from 'zod';
import { parseToolArgs, toToolError, type McpToolDefinition } from '../../tools/registry-types';
import { ReadModelError } from '../../../application/read-models-v1/errors';
import type { HttpJson } from '../clients/http-json';
import { buildSimpleDag, buildCommitteeDag } from './agent-dags';

const TICKER_RE = /^[A-Za-z]{4}\d{1,2}$/;

const submitShape = {
  template: z.enum(['SIMPLES', 'COMITE']),
  kind: z.enum(['RESEARCH', 'PROPOSAL']),
  question: z.string().min(1),
  ticker: z.string().optional(),
  llmProvider: z.string().optional(),
  llmModel: z.string().optional(),
  maxSteps: z.number().int().min(1).max(10_000).optional(),
};

export function buildAgentActionTools(next: HttpJson): readonly McpToolDefinition[] {
  return [
    {
      name: 'agent_run.submit',
      description: 'Cria e enfileira um AgentRun (template SIMPLES ou COMITE) a partir de uma pergunta.',
      privilege: 'free',
      inputSchema: submitShape,
      handler: async (args) => {
        try {
          const parsed = parseToolArgs(submitShape, args);
          const maxSteps = parsed.maxSteps ?? 100;

          let ticker: string | undefined;
          if (parsed.template === 'COMITE') {
            const candidate = (parsed.ticker ?? '').trim().toUpperCase();
            if (!TICKER_RE.test(candidate)) {
              throw new ReadModelError(
                'INVALID_QUERY',
                'o comitê delibera sobre 1 ativo: informe um ticker B3 válido (ex.: WEGE3)',
              );
            }
            ticker = candidate;
          }

          const dag = parsed.template === 'COMITE' ? buildCommitteeDag() : buildSimpleDag(parsed.kind);
          const budget =
            parsed.template === 'COMITE'
              ? { maxSteps, maxCost: 30_000, timeoutMs: 300_000 }
              : { maxSteps, timeoutMs: 300_000 };

          const body = {
            kind: parsed.kind,
            dag,
            input: {
              question: parsed.question,
              ...(ticker ? { ticker } : {}),
              ...(parsed.llmProvider ? { llmProvider: parsed.llmProvider } : {}),
              ...(parsed.llmModel ? { llmModel: parsed.llmModel } : {}),
            },
            budget,
            decisionTime: new Date(Date.now() + 60_000).toISOString(),
          };

          return { content: [{ type: 'text', text: JSON.stringify(await next.post('/api/v1/agent-runs', body)) }] };
        } catch (error) { return toToolError(error); }
      },
    },
    {
      name: 'agent_run.advance',
      description: 'Processa o próximo passo de um AgentRun até esgotar orçamento ou concluir.',
      privilege: 'free',
      inputSchema: { runId: z.string().min(1) },
      handler: async (args) => {
        try {
          const { runId } = parseToolArgs({ runId: z.string().min(1) }, args);
          return { content: [{ type: 'text', text: JSON.stringify(await next.post(`/api/v1/agent-runs/${encodeURIComponent(runId)}/advance`, undefined)) }] };
        } catch (error) { return toToolError(error); }
      },
    },
    {
      name: 'agent_run.cancel',
      description: 'Cancela um AgentRun QUEUED ou RUNNING.',
      privilege: 'free',
      inputSchema: { runId: z.string().min(1) },
      handler: async (args) => {
        try {
          const { runId } = parseToolArgs({ runId: z.string().min(1) }, args);
          return { content: [{ type: 'text', text: JSON.stringify(await next.post(`/api/v1/agent-runs/${encodeURIComponent(runId)}/cancel`, undefined)) }] };
        } catch (error) { return toToolError(error); }
      },
    },
    {
      name: 'agent_run.list',
      description: 'Lista AgentRuns (opcionalmente filtrando por status e limitando a quantidade).',
      privilege: 'free',
      inputSchema: { limit: z.number().int().min(1).max(1000).optional(), status: z.enum(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED']).optional() },
      handler: async (args) => {
        try {
          const { limit, status } = parseToolArgs({ limit: z.number().int().min(1).max(1000).optional(), status: z.enum(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED']).optional() }, args);
          const params = new URLSearchParams();
          if (limit !== undefined) params.set('limit', String(limit));
          if (status !== undefined) params.set('status', status);
          const qs = params.toString();
          return { content: [{ type: 'text', text: JSON.stringify(await next.get(`/api/v1/agent-runs${qs ? `?${qs}` : ''}`)) }] };
        } catch (error) { return toToolError(error); }
      },
    },
  ];
}
