/**
 * Server-side LLM providers — WR Trading Pro
 *
 * Toda chamada a provedor LLM (remoto ou local) acontece AQUI, no backend.
 * O frontend consome exclusivamente o proxy /api/llm/chat; nenhuma chave
 * ou endpoint controlado pelo cliente chega a este módulo.
 */

import { LLMProvider, LLMMessage, LLMConfig, LLMResponse, LLMChatRequest } from '@/types/llm';
import { getOllamaEndpoint, getOllamaDefaultModel, getServerLlmKeys } from '@/lib/server/llm-config';

interface ILLMProvider {
  name: LLMProvider;
  chat(messages: LLMMessage[], config?: Partial<LLMConfig>): Promise<LLMResponse>;
  isConfigured(): boolean;
}

/**
 * Provedor genérico compatível com a API chat/completions da OpenAI
 * (OpenAI, Deepseek, Qwen, Groq, Manus usam o mesmo formato).
 */
class OpenAICompatibleProvider implements ILLMProvider {
  name: LLMProvider;
  private apiKey: string;
  private endpoint: string;
  private defaultModel: string;
  private defaultTemperature: number;

  constructor(
    name: LLMProvider,
    apiKey: string,
    endpoint: string,
    defaultModel: string,
    defaultTemperature = 0.7
  ) {
    this.name = name;
    this.apiKey = apiKey;
    this.endpoint = endpoint;
    this.defaultModel = defaultModel;
    this.defaultTemperature = defaultTemperature;
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  async chat(messages: LLMMessage[], config?: Partial<LLMConfig>): Promise<LLMResponse> {
    if (!this.isConfigured()) {
      throw new Error(`${this.name} API key not configured`);
    }

    const model = config?.model || this.defaultModel;
    const temperature = config?.temperature ?? this.defaultTemperature;
    const maxTokens = config?.maxTokens ?? 2000;

    try {
      const response = await fetch(this.endpoint, {
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
        const error = await response.json().catch(() => null);
        throw new Error(`${this.name} API error: ${error?.error?.message || response.statusText}`);
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
      throw new Error(`${this.name} provider error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

/**
 * Ollama Provider (local) — endpoint vem exclusivamente da allowlist
 * server-side (getOllamaEndpoint), nunca do cliente.
 */
class OllamaProvider implements ILLMProvider {
  name: LLMProvider = 'OLLAMA';
  private endpoint: string;
  private defaultModel: string;

  constructor(endpoint: string, defaultModel: string = getOllamaDefaultModel()) {
    this.endpoint = endpoint;
    this.defaultModel = defaultModel;
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
 * Contexto de mercado enviado pelo frontend (shape do buildMarketContext).
 */
interface MarketContextLike {
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
 * Orquestrador server-side com fallback entre provedores configurados.
 */
class ServerLLMService {
  private providers: Map<LLMProvider, ILLMProvider> = new Map();
  private fallbackOrder: LLMProvider[] = ['OPENAI', 'DEEPSEEK', 'GROQ', 'QWEN', 'OLLAMA', 'MANUS'];

  constructor() {
    this.initializeProviders();
  }

  private initializeProviders() {
    const keys = getServerLlmKeys();

    if (keys.openai) {
      this.providers.set('OPENAI', new OpenAICompatibleProvider(
        'OPENAI', keys.openai, 'https://api.openai.com/v1/chat/completions', 'gpt-4-turbo-preview', 0.1
      ));
    }
    if (keys.deepseek) {
      this.providers.set('DEEPSEEK', new OpenAICompatibleProvider(
        'DEEPSEEK', keys.deepseek, 'https://api.deepseek.com/v1/chat/completions', 'deepseek-chat', 0.1
      ));
    }
    if (keys.qwen) {
      this.providers.set('QWEN', new OpenAICompatibleProvider(
        'QWEN', keys.qwen, 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', 'qwen-turbo'
      ));
    }
    if (keys.groq) {
      this.providers.set('GROQ', new OpenAICompatibleProvider(
        'GROQ', keys.groq, 'https://api.groq.com/openai/v1/chat/completions', 'llama-3.3-70b-versatile'
      ));
    }
    if (keys.manus) {
      this.providers.set('MANUS', new OpenAICompatibleProvider(
        'MANUS', keys.manus, 'https://api.manus.ai/v1/chat/completions', 'manus-1'
      ));
    }

    // Ollama local sempre disponível via allowlist server-side
    this.providers.set('OLLAMA', new OllamaProvider(getOllamaEndpoint()));
  }

  getAvailableProviders(): LLMProvider[] {
    return Array.from(this.providers.keys());
  }

  isProviderConfigured(provider: LLMProvider): boolean {
    const p = this.providers.get(provider);
    return p ? p.isConfigured() : false;
  }

  async chat(request: LLMChatRequest): Promise<LLMResponse> {
    const { messages, config, context } = request;

    let enhancedMessages = [...messages];
    if (context) {
      const systemMessage = this.buildSystemMessage(context);
      enhancedMessages = [systemMessage, ...messages];
    }

    const preferredProvider = config?.provider || this.fallbackOrder[0];

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

  private buildSystemMessage(context: any): LLMMessage {
    let contextText = 'You are a professional trading assistant for the WR Trading Pro platform. ';
    contextText += 'Answer in the same language the user writes in. ';

    if (context?.market) {
      const m = context.market as MarketContextLike;
      contextText +=
        `\n\n[LIVE MARKET CONTEXT — ${m.timestamp}]\n` +
        `Symbol: ${m.symbol} | Bid: ${m.bid} | Ask: ${m.ask} | Spread: ${m.spread}\n` +
        `Balance: ${m.accountBalance} | Equity: ${m.accountEquity} | Daily P&L: ${m.dailyResult}\n`;

      if (Array.isArray(m.openPositions) && m.openPositions.length > 0) {
        contextText += `Open Positions (${m.openPositions.length}):\n`;
        m.openPositions.forEach((p) => {
          contextText +=
            `  ${p.type} ${p.volume} ${p.symbol} @ ${p.openPrice} (now ${p.currentPrice}, P&L ${p.profit})\n`;
        });
      } else {
        contextText += `Open Positions: none\n`;
      }
    }

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
}

export const serverLlmService = new ServerLLMService();
