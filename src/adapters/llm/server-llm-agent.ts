/**
 * Adapter da porta AgentLlmPort para o proxy LLM server-side — WR Trading Pro
 *
 * Delega ao serverLlmService (única fonte de chamadas LLM do backend).
 * Sem preferência do run (Auto), o proxy pode cair no fallback entre
 * provedores configurados. Quando o run pede um provider explícito
 * (opts.provider, vindo de input.llmProvider — ver AgentRunsPanel/service.ts),
 * a chamada roda em modo `noFallback`: se o provider pedido não estiver
 * configurado ou a chamada falhar, o erro é propagado (nunca substituído
 * silenciosamente por outro provider) — quem chama decide o que fazer
 * (o runtime AgentRun marca o nó como simulado com o motivo explícito).
 * Credenciais e endpoints vêm exclusivamente da configuração server-side —
 * nada do cliente chega aqui (Fase 0, itens 5-7).
 */

import { LLM_PROVIDERS, LLM_MODEL_ID_PATTERN, type LLMProvider } from '../../types/llm';
import type { AgentLlmCompletion, AgentLlmMessage, AgentLlmOptions, AgentLlmPort } from '../../domain/v1/ports/agent-llm';
import { serverLlmService } from '../../lib/server/llm-providers';

const KNOWN_PROVIDERS: readonly LLMProvider[] = LLM_PROVIDERS;
const MODEL_NAME_PATTERN = LLM_MODEL_ID_PATTERN;

function normalizeProvider(value: string | undefined): LLMProvider | undefined {
  if (!value) return undefined;
  const upper = value.toUpperCase();
  return KNOWN_PROVIDERS.find((p) => p === upper);
}

/** Estimativa conservadora (~4 chars/token) quando o provedor não informa usage. */
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export class ServerLlmAgentAdapter implements AgentLlmPort {
  async complete(messages: readonly AgentLlmMessage[], opts?: AgentLlmOptions): Promise<AgentLlmCompletion> {
    const provider = normalizeProvider(opts?.provider);
    const model = opts?.model && MODEL_NAME_PATTERN.test(opts.model) ? opts.model : undefined;
    const response = await serverLlmService.chat({
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      // timeoutMs: orçamento restante do run quando presente; ausente, o
      // provider aplica o default de proteção (clamp em llm-providers).
      // noFallback: quando o usuário pediu um provider específico (ex.: Runs
      // Governados), a falha desse provider NUNCA deve ser mascarada usando
      // outro silenciosamente — propaga o erro (o nó cai para simulado com o
      // motivo explícito). Sem preferência (Auto), o fallback normal continua.
      config: {
        maxTokens: opts?.maxTokens ?? 1200,
        temperature: 0.2,
        provider,
        model,
        timeoutMs: opts?.timeoutMs,
        noFallback: !!provider,
      },
    });

    const promptChars = messages.reduce((acc, m) => acc + m.content.length, 0);
    return {
      content: response.content,
      provider: response.provider,
      model: response.model ?? 'desconhecido',
      totalTokens:
        response.usage?.totalTokens && response.usage.totalTokens > 0
          ? response.usage.totalTokens
          : estimateTokens(response.content) + estimateTokens(' '.repeat(promptChars)),
    };
  }
}

export const serverLlmAgentAdapter = new ServerLlmAgentAdapter();
