export type LLMProvider = 'OPENAI' | 'DEEPSEEK' | 'OLLAMA' | 'QWEN' | 'GROQ' | 'MANUS';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMConfig {
  provider: LLMProvider;
  apiKey?: string;
  endpoint?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
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

export interface LLMChatRequest {
  messages: LLMMessage[];
  config?: Partial<LLMConfig>;
  context?: {
    market?: import('@/services/llmService').MarketContext;
    marketData?: any;
    portfolio?: any;
    indicators?: any;
  };
}