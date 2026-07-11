import { LLMProvider, LLMMessage, LLMConfig, LLMResponse, LLMChatRequest } from '@/types/llm';

// ─── Market Context ──────────────────────────────────────────────────────────

export interface MarketContext {
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

/**
 * Build a MarketContext object from live MT5 data.
 * Call this immediately before llmService.chat() in the UI layer.
 */
export function buildMarketContext(
  accountInfo: { balance: number; equity: number; profit: number } | null,
  tickData: Map<string, { bid?: number; ask?: number }>,
  selectedSymbol: string
): MarketContext | null {
  if (!accountInfo) return null;

  const tick = tickData.get(selectedSymbol);
  const bid = tick?.bid ?? 0;
  const ask = tick?.ask ?? 0;

  return {
    symbol: selectedSymbol,
    bid,
    ask,
    spread: parseFloat((ask - bid).toFixed(5)),
    accountBalance: accountInfo.balance,
    accountEquity: accountInfo.equity,
    dailyResult: accountInfo.profit,
    openPositions: [],
    timestamp: new Date().toISOString(),
  };
}

/**
 * Base LLM Provider Interface
 */
interface ILLMProvider {
  name: LLMProvider;
  chat(messages: LLMMessage[], config?: Partial<LLMConfig>): Promise<LLMResponse>;
  isConfigured(): boolean;
}

/**
 * OpenAI Provider
 */
class OpenAIProvider implements ILLMProvider {
  name: LLMProvider = 'OPENAI';
  private apiKey: string;
  private defaultModel = 'gpt-4-turbo-preview';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  async chat(messages: LLMMessage[], config?: Partial<LLMConfig>): Promise<LLMResponse> {
    if (!this.isConfigured()) {
      throw new Error('OpenAI API key not configured');
    }

    const model = config?.model || this.defaultModel;
    const temperature = config?.temperature ?? 0.1;
    const maxTokens = config?.maxTokens ?? 2000;

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`OpenAI API error: ${error.error?.message || response.statusText}`);
      }

      const data = await response.json();
      return {
        content: data.choices[0].message.content,
        provider: this.name,
        model,
        usage: {
          promptTokens: data.usage?.prompt_tokens || 0,
          completionTokens: data.usage?.completion_tokens || 0,
          totalTokens: data.usage?.total_tokens || 0,
        },
      };
    } catch (error) {
      throw new Error(`OpenAI provider error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

/**
 * Deepseek Provider
 */
class DeepseekProvider implements ILLMProvider {
  name: LLMProvider = 'DEEPSEEK';
  private apiKey: string;
  private defaultModel = 'deepseek-chat';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  async chat(messages: LLMMessage[], config?: Partial<LLMConfig>): Promise<LLMResponse> {
    if (!this.isConfigured()) {
      throw new Error('Deepseek API key not configured');
    }

    const model = config?.model || this.defaultModel;
    const temperature = config?.temperature ?? 0.1;
    const maxTokens = config?.maxTokens ?? 2000;

    try {
      const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Deepseek API error: ${error.error?.message || response.statusText}`);
      }

      const data = await response.json();
      return {
        content: data.choices[0].message.content,
        provider: this.name,
        model,
        usage: {
          promptTokens: data.usage?.prompt_tokens || 0,
          completionTokens: data.usage?.completion_tokens || 0,
          totalTokens: data.usage?.total_tokens || 0,
        },
      };
    } catch (error) {
      throw new Error(`Deepseek provider error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

/**
 * Ollama Provider (Local)
 */
class OllamaProvider implements ILLMProvider {
  name: LLMProvider = 'OLLAMA';
  private endpoint: string;
  private defaultModel = 'llama3.2:3b';

  constructor(endpoint: string = 'http://localhost:11434') {
    this.endpoint = endpoint;
  }

  isConfigured(): boolean {
    return !!this.endpoint;
  }

  async chat(messages: LLMMessage[], config?: Partial<LLMConfig>): Promise<LLMResponse> {
    if (!this.isConfigured()) {
      throw new Error('Ollama endpoint not configured');
    }

    const model = config?.model || this.defaultModel;

    try {
      const response = await fetch(`${this.endpoint}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages,
          stream: false,
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.statusText}`);
      }

      const data = await response.json();
      return {
        content: data.message?.content || '',
        provider: this.name,
        model,
      };
    } catch (error) {
      throw new Error(`Ollama provider error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

/**
 * Qwen Provider (Alibaba Cloud)
 */
class QwenProvider implements ILLMProvider {
  name: LLMProvider = 'QWEN';
  private apiKey: string;
  private defaultModel = 'qwen-turbo';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  async chat(messages: LLMMessage[], config?: Partial<LLMConfig>): Promise<LLMResponse> {
    if (!this.isConfigured()) {
      throw new Error('Qwen API key not configured');
    }

    const model = config?.model || this.defaultModel;
    const temperature = config?.temperature ?? 0.7;
    const maxTokens = config?.maxTokens ?? 2000;

    try {
      const response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Qwen API error: ${error.error?.message || response.statusText}`);
      }

      const data = await response.json();
      return {
        content: data.choices[0].message.content,
        provider: this.name,
        model,
        usage: {
          promptTokens: data.usage?.prompt_tokens || 0,
          completionTokens: data.usage?.completion_tokens || 0,
          totalTokens: data.usage?.total_tokens || 0,
        },
      };
    } catch (error) {
      throw new Error(`Qwen provider error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

/**
 * Groq Provider
 */
class GroqProvider implements ILLMProvider {
  name: LLMProvider = 'GROQ';
  private apiKey: string;
  private defaultModel = 'llama-3.3-70b-versatile';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  async chat(messages: LLMMessage[], config?: Partial<LLMConfig>): Promise<LLMResponse> {
    if (!this.isConfigured()) {
      throw new Error('Groq API key not configured');
    }

    const model = config?.model || this.defaultModel;
    const temperature = config?.temperature ?? 0.7;
    const maxTokens = config?.maxTokens ?? 2000;

    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Groq API error: ${error.error?.message || response.statusText}`);
      }

      const data = await response.json();
      return {
        content: data.choices[0].message.content,
        provider: this.name,
        model,
        usage: {
          promptTokens: data.usage?.prompt_tokens || 0,
          completionTokens: data.usage?.completion_tokens || 0,
          totalTokens: data.usage?.total_tokens || 0,
        },
      };
    } catch (error) {
      throw new Error(`Groq provider error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

/**
 * Manus LLM Provider (Fallback)
 */
class ManusProvider implements ILLMProvider {
  name: LLMProvider = 'MANUS';
  private apiKey: string;
  private defaultModel = 'manus-1';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  async chat(messages: LLMMessage[], config?: Partial<LLMConfig>): Promise<LLMResponse> {
    if (!this.isConfigured()) {
      throw new Error('Manus API key not configured');
    }

    const model = config?.model || this.defaultModel;
    const temperature = config?.temperature ?? 0.7;
    const maxTokens = config?.maxTokens ?? 2000;

    try {
      const response = await fetch('https://api.manus.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Manus API error: ${error.error?.message || response.statusText}`);
      }

      const data = await response.json();
      return {
        content: data.choices[0].message.content,
        provider: this.name,
        model,
        usage: {
          promptTokens: data.usage?.prompt_tokens || 0,
          completionTokens: data.usage?.completion_tokens || 0,
          totalTokens: data.usage?.total_tokens || 0,
        },
      };
    } catch (error) {
      throw new Error(`Manus provider error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

/**
 * LLM Service - Main orchestrator with fallback support
 */
class LLMService {
  private providers: Map<LLMProvider, ILLMProvider> = new Map();
  private fallbackOrder: LLMProvider[] = ['OPENAI', 'DEEPSEEK', 'GROQ', 'QWEN', 'OLLAMA', 'MANUS'];

  constructor() {
    this.initializeProviders();
  }

  private initializeProviders() {
    // Initialize providers from environment variables
    const openaiKey = process.env.NEXT_PUBLIC_OPENAI_API_KEY;
    const deepseekKey = process.env.NEXT_PUBLIC_DEEPSEEK_API_KEY;
    const ollamaEndpoint = process.env.NEXT_PUBLIC_OLLAMA_ENDPOINT || 'http://localhost:11434';
    const qwenKey = process.env.NEXT_PUBLIC_QWEN_API_KEY;
    const groqKey = process.env.NEXT_PUBLIC_GROQ_API_KEY;
    const manusKey = process.env.NEXT_PUBLIC_MANUS_API_KEY;

    if (openaiKey) {
      this.providers.set('OPENAI', new OpenAIProvider(openaiKey));
    }
    if (deepseekKey) {
      this.providers.set('DEEPSEEK', new DeepseekProvider(deepseekKey));
    }
    if (ollamaEndpoint) {
      this.providers.set('OLLAMA', new OllamaProvider(ollamaEndpoint));
    }
    if (qwenKey) {
      this.providers.set('QWEN', new QwenProvider(qwenKey));
    }
    if (groqKey) {
      this.providers.set('GROQ', new GroqProvider(groqKey));
    }
    if (manusKey) {
      this.providers.set('MANUS', new ManusProvider(manusKey));
    }
  }

  /**
   * Get available providers
   */
  getAvailableProviders(): LLMProvider[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Check if a provider is configured
   */
  isProviderConfigured(provider: LLMProvider): boolean {
    const p = this.providers.get(provider);
    return p ? p.isConfigured() : false;
  }

  /**
   * Chat with specified provider with automatic fallback
   */
  async chat(request: LLMChatRequest): Promise<LLMResponse> {
    const { messages, config, context } = request;
    
    // Add context to system message if provided
    let enhancedMessages = [...messages];
    if (context) {
      const systemMessage = this.buildSystemMessage(context);
      enhancedMessages = [systemMessage, ...messages];
    }

    const preferredProvider = config?.provider || this.fallbackOrder[0];
    
    // Try preferred provider first
    if (this.isProviderConfigured(preferredProvider)) {
      try {
        const provider = this.providers.get(preferredProvider);
        if (provider) {
          return await provider.chat(enhancedMessages, config);
        }
      } catch (error) {
        console.error(`Provider ${preferredProvider} failed:`, error);
      }
    }

    // Fallback to other providers
    for (const providerName of this.fallbackOrder) {
      if (providerName === preferredProvider) continue;
      
      if (this.isProviderConfigured(providerName)) {
        try {
          const provider = this.providers.get(providerName);
          if (provider) {
            console.log(`Falling back to ${providerName}`);
            return await provider.chat(enhancedMessages, config);
          }
        } catch (error) {
          console.error(`Provider ${providerName} failed:`, error);
        }
      }
    }

    throw new Error('No LLM provider is available or configured');
  }

  /**
   * Build system message with trading context
   */
  private buildSystemMessage(context: any): LLMMessage {
    let contextText = 'You are a professional trading assistant for the WR Trading Pro platform. ';
    contextText += 'Answer in the same language the user writes in. ';

    // Structured market context (from buildMarketContext helper)
    if (context?.market) {
      const m = context.market as MarketContext;
      contextText +=
        `\n\n[LIVE MARKET CONTEXT — ${m.timestamp}]\n` +
        `Symbol: ${m.symbol} | Bid: ${m.bid} | Ask: ${m.ask} | Spread: ${m.spread}\n` +
        `Balance: ${m.accountBalance} | Equity: ${m.accountEquity} | Daily P&L: ${m.dailyResult}\n`;

      if (m.openPositions.length > 0) {
        contextText += `Open Positions (${m.openPositions.length}):\n`;
        m.openPositions.forEach((p) => {
          contextText +=
            `  ${p.type} ${p.volume} ${p.symbol} @ ${p.openPrice} (now ${p.currentPrice}, P&L ${p.profit})\n`;
        });
      } else {
        contextText += `Open Positions: none\n`;
      }
    }

    // Legacy generic fields (backward compat)
    if (context?.marketData) {
      contextText += `\nMarket data: ${JSON.stringify(context.marketData)}. `;
    }
    if (context?.portfolio) {
      contextText += `Portfolio: ${JSON.stringify(context.portfolio)}. `;
    }
    if (context?.indicators) {
      contextText += `Indicators: ${JSON.stringify(context.indicators)}. `;
    }

    contextText += '\nProvide clear, actionable trading advice with proper risk management.';

    return { role: 'system', content: contextText };
  }

  /**
   * Reinitialize providers (useful for runtime configuration updates)
   */
  reinitialize() {
    this.providers.clear();
    this.initializeProviders();
  }
}

// Export singleton instance
export const llmService = new LLMService();
export default LLMService;