export type LLMProvider = 'OPENAI' | 'DEEPSEEK' | 'OLLAMA' | 'QWEN' | 'GROQ' | 'MANUS';

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