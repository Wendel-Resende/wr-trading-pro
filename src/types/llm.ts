/** Todos os providers reconhecidos pelo contrato — fonte única para tipo/schemas/validação. */
export const LLM_PROVIDERS = [
  'OPENAI',
  'DEEPSEEK',
  'OLLAMA',
  'QWEN',
  'GROQ',
  'MANUS',
  'LM_STUDIO',
  'OPENROUTER',
  'ANTHROPIC',
] as const;

export type LLMProvider = (typeof LLM_PROVIDERS)[number];

/** Providers com API key/modelo/endpoint configuráveis pela UI de Configurações de IA. */
export const LLM_UI_CONFIGURABLE_PROVIDERS = [
  'OPENAI',
  'DEEPSEEK',
  'OPENROUTER',
  'ANTHROPIC',
  'LM_STUDIO',
] as const;

export type LlmUiConfigurableProvider = (typeof LLM_UI_CONFIGURABLE_PROVIDERS)[number];

/**
 * Regex compartilhada para ids de modelo: sem espaço, sem controle de
 * header, sem URL — apenas [A-Za-z0-9_.:/-], com um negative lookahead
 * bloqueando qualquer ocorrência de "://" (assinatura de esquema de URL).
 * ':' e '/' seguem permitidos isoladamente para ids como "llama3.2:3b"
 * (Ollama) e "openrouter/free" / "mistralai/mistral-7b" (OpenRouter).
 */
export const LLM_MODEL_ID_PATTERN = /^(?!.*:\/\/)[\w][\w.\-:/]{0,127}$/;

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// Nota de segurança (Fase 0, item 7): este config trafega do frontend para o
// proxy /api/llm/chat. Ele NÃO deve conter apiKey nem endpoint — segredos e
// endpoints de provedor são exclusivamente server-side (src/lib/server/llm-config.ts).
export interface LLMConfig {
  provider: LLMProvider;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Limite da chamada em ms; clampado server-side (default 120s, teto 600s). */
  timeoutMs?: number;
  /**
   * Campo INTERNO — nunca aceito no schema estrito do proxy HTTP (client
   * jamais pode setá-lo). Quando true, exige `provider` explícito e nunca
   * substitui silenciosamente por outro provider em caso de falha/indisponibilidade:
   * a chamada rejeita imediatamente. Usado pelo adapter de Runs Governados
   * (ServerLlmAgentAdapter) quando o usuário escolheu um provider específico —
   * ver ServerLLMService.chat() em llm-providers.ts.
   */
  noFallback?: boolean;
}

export interface LLMResponse {
  content: string;
  provider: LLMProvider;
  model?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface LLMProviderConfig {
  id: string;
  name: LLMProvider;
  displayName: string;
  apiKey?: string;
  endpoint?: string;
  model?: string;
  isActive: boolean;
  priority: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Contexto de mercado enviado pelo frontend (shape do buildMarketContext). */
export interface LLMMarketContext {
  symbol: string;
  bid: number;
  ask: number;
  spread: number;
  accountBalance: number;
  accountEquity: number;
  dailyResult: number;
  openPositions: Array<{
    ticket: number;
    symbol: string;
    type: string;
    volume: number;
    openPrice: number;
    currentPrice: number;
    profit: number;
  }>;
  timestamp: string;
}

export interface LLMChatRequest {
  messages: LLMMessage[];
  config?: Partial<LLMConfig>;
  context?: {
    market?: LLMMarketContext;
    marketData?: any;
    portfolio?: any;
    indicators?: any;
  };
}

/** Nomes de exibição — compartilhado entre a UI e as rotas de status. */
export const LLM_PROVIDER_DISPLAY_NAMES: Record<LLMProvider, string> = {
  OPENAI: 'OpenAI',
  DEEPSEEK: 'DeepSeek',
  OLLAMA: 'Ollama (Local)',
  QWEN: 'Qwen (Alibaba)',
  GROQ: 'Groq',
  MANUS: 'Manus',
  LM_STUDIO: 'LM Studio (Local)',
  OPENROUTER: 'OpenRouter',
  ANTHROPIC: 'Anthropic (Claude)',
};

/**
 * Status sanitizado de um provider configurável pela UI — usado pela rota
 * GET /api/llm/config. NUNCA carrega apiKey, ciphertext, nonce ou payload de
 * upstream: apenas provider/enabled/displayName/modelo/endpoint local.
 */
export interface LlmProviderStatus {
  provider: LlmUiConfigurableProvider;
  displayName: string;
  configured: boolean;
  /** De onde vem a configuração ativa: salva pela UI, do .env, ou nenhuma. */
  source: 'ui' | 'env' | 'none';
  /** Modelo padrão efetivo (não secreto). */
  model?: string;
  /** Endpoint local sanitizado — presente somente para LM_STUDIO. */
  endpoint?: string;
}