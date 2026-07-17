/**
 * Adapter da porta AgentLlmPort para o proxy LLM server-side — WR Trading Pro
 *
 * Delega ao serverLlmService (única fonte de chamadas LLM do backend, com
 * fallback entre provedores configurados: OpenAI/DeepSeek/Groq/Qwen/Ollama).
 * Chaves e endpoints vêm exclusivamente de env vars server-side — nada do
 * cliente chega aqui (Fase 0, itens 5-7).
 */

import type { LLMProvider } from '../../types/llm';
import type { AgentLlmCompletion, AgentLlmMessage, AgentLlmOptions, AgentLlmPort } from '../../domain/v1/ports/agent-llm';
import { serverLlmService } from '../../lib/server/llm-providers';

const KNOWN_PROVIDERS: readonly LLMProvider[] = ['OPENAI', 'DEEPSEEK', 'QWEN', 'GROQ', 'OLLAMA', 'MANUS'];
const MODEL_NAME_PATTERN = /^[\w][\w.\-:]{0,63}$/;

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
      config: { maxTokens: opts?.maxTokens ?? 1200, temperature: 0.2, provider, model, timeoutMs: opts?.timeoutMs },
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
