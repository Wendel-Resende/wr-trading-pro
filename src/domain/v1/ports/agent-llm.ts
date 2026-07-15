/**
 * Porta de LLM para os nós AGENT/SYNTHESIS do runtime AgentRun — WR Trading Pro
 *
 * O serviço de aplicação depende apenas desta interface; o adapter concreto
 * (proxy LLM server-side) vive em src/adapters/llm. A porta é OPCIONAL no
 * serviço: sem ela, o runtime mantém o processamento determinístico simulado
 * (usado pelos testes e como fallback quando nenhum provedor responde).
 *
 * Regras que o runtime garante independentemente do que o LLM devolver:
 * o LLM produz CONTEÚDO (análise, tese, riscos); a ESTRUTURA do contrato
 * final (kind, decisionTime, requiresHumanApproval, evidence) é montada e
 * sanitizada pelo runtime. Propostas nunca geram ordens.
 */

export interface AgentLlmMessage {
  readonly role: 'system' | 'user';
  readonly content: string;
}

export interface AgentLlmCompletion {
  readonly content: string;
  readonly provider: string;
  readonly model: string;
  /** Total de tokens da chamada (prompt + resposta); estimado quando o provedor não informa. */
  readonly totalTokens: number;
}

export interface AgentLlmOptions {
  readonly maxTokens?: number;
  /** Provedor preferido (ex.: 'OLLAMA'); inválido/indisponível cai no fallback do proxy. */
  readonly provider?: string;
  /** Modelo preferido no provedor (ex.: 'qwen3.5:4b'). */
  readonly model?: string;
}

export interface AgentLlmPort {
  complete(messages: readonly AgentLlmMessage[], opts?: AgentLlmOptions): Promise<AgentLlmCompletion>;
}
