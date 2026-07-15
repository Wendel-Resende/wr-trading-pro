/**
 * Adapter da porta AgentLlmPort para o proxy LLM server-side — WR Trading Pro
 *
 * Delega ao serverLlmService (única fonte de chamadas LLM do backend, com
 * fallback entre provedores configurados: OpenAI/DeepSeek/Groq/Qwen/Ollama).
 * Chaves e endpoints vêm exclusivamente de env vars server-side — nada do
 * cliente chega aqui (Fase 0, itens 5-7).
 */

import type { AgentLlmCompletion, AgentLlmMessage, AgentLlmPort } from '../../domain/v1/ports/agent-llm';
import { serverLlmService } from '../../lib/server/llm-providers';

/** Estimativa conservadora (~4 chars/token) quando o provedor não informa usage. */
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export class ServerLlmAgentAdapter implements AgentLlmPort {
  async complete(
    messages: readonly AgentLlmMessage[],
    opts?: { readonly maxTokens?: number }
  ): Promise<AgentLlmCompletion> {
    const response = await serverLlmService.chat({
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      config: { maxTokens: opts?.maxTokens ?? 1200, temperature: 0.2 },
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
