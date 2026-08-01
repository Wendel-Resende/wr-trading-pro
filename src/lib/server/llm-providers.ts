/**
 * Server-side LLM providers — WR Trading Pro
 *
 * Toda chamada a provedor LLM (remoto ou local) acontece AQUI, no backend.
 * O frontend consome exclusivamente o proxy /api/llm/chat; nenhuma chave
 * ou endpoint controlado pelo cliente chega a este módulo.
 *
 * Providers: OpenAI, DeepSeek, Qwen, Groq, Manus e OpenRouter compartilham o
 * formato OpenAI-compatible (OpenAICompatibleProvider). LM Studio também usa
 * esse formato, mas com API key opcional. Anthropic usa a API nativa
 * Messages (AnthropicProvider) — payload e headers distintos.
 *
 * Nenhuma chamada a provedor pode ficar pendurada nem executar ordens: este
 * módulo é usado exclusivamente para análise/assistente (chat, sugestão de
 * operação em modo consultivo). Nenhum adapter cria OrderIntent nem contorna
 * WR_TRADING_ENABLED/aprovação humana.
 */

import { LLMProvider, LLMMessage, LLMConfig, LLMResponse, LLMChatRequest, LLMMarketContext } from '../../types/llm';
import {
  getOllamaEndpoint,
  getOllamaDefaultModel,
  getServerLlmKeys,
  resolveProviderCredential,
  isAllowedLocalUrl,
} from './llm-config';

interface ILLMProvider {
  name: LLMProvider;
  chat(messages: LLMMessage[], config?: Partial<LLMConfig>): Promise<LLMResponse>;
  isConfigured(): boolean;
}

// Nenhuma chamada a provedor pode ficar pendurada: um provedor que aceita a
// conexão e nunca responde deixaria o AgentRun em RUNNING para sempre (o
// timeoutMs do orçamento só é avaliado entre nós). Todo fetch usa
// AbortSignal.timeout; o valor vem do chamador (clampado) ou do default.
const DEFAULT_LLM_TIMEOUT_MS = 120_000;
const MAX_LLM_TIMEOUT_MS = 600_000;

function resolveTimeoutMs(configured: number | undefined): number {
  if (typeof configured !== 'number' || !Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_LLM_TIMEOUT_MS;
  }
  return Math.min(Math.ceil(configured), MAX_LLM_TIMEOUT_MS);
}

function isAbortLike(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

/**
 * Provedor genérico compatível com a API chat/completions da OpenAI
 * (OpenAI, DeepSeek, Qwen, Groq, Manus, LM Studio, OpenRouter usam o mesmo
 * formato de payload).
 */
export class OpenAICompatibleProvider implements ILLMProvider {
  name: LLMProvider;
  private apiKey: string | undefined;
  private endpoint: string;
  private defaultModel: string | undefined;
  private defaultTemperature: number;
  private extraHeaders: Record<string, string>;
  private requireApiKey: boolean;

  constructor(
    name: LLMProvider,
    apiKey: string | undefined,
    endpoint: string,
    defaultModel: string | undefined,
    defaultTemperature = 0.7,
    extraHeaders: Record<string, string> = {},
    requireApiKey = true
  ) {
    this.name = name;
    this.apiKey = apiKey;
    this.endpoint = endpoint;
    this.defaultModel = defaultModel;
    this.defaultTemperature = defaultTemperature;
    this.extraHeaders = extraHeaders;
    this.requireApiKey = requireApiKey;
  }

  isConfigured(): boolean {
    return this.requireApiKey ? !!this.apiKey : true;
  }

  async chat(messages: LLMMessage[], config?: Partial<LLMConfig>): Promise<LLMResponse> {
    if (!this.isConfigured()) {
      throw new Error(`${this.name} API key not configured`);
    }

    const model = config?.model || this.defaultModel;
    if (!model) {
      throw new Error(`${this.name} provider error: nenhum modelo configurado`);
    }
    const temperature = config?.temperature ?? this.defaultTemperature;
    const maxTokens = config?.maxTokens ?? 2000;
    const timeoutMs = resolveTimeoutMs(config?.timeoutMs);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...this.extraHeaders,
      };
      if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(`${this.name} API error: ${error?.error?.message || response.statusText}`);
      }

      const data = await response.json().catch(() => null);
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') {
        throw new Error(`${this.name} resposta malformada: campo choices[0].message.content ausente`);
      }

      return {
        content,
        provider: this.name,
        model,
        usage: {
          promptTokens: data?.usage?.prompt_tokens ?? 0,
          completionTokens: data?.usage?.completion_tokens ?? 0,
          totalTokens: data?.usage?.total_tokens ?? 0,
        },
      };
    } catch (error) {
      if (isAbortLike(error)) {
        throw new Error(`${this.name} provider error: timeout após ${timeoutMs}ms sem resposta do provedor`);
      }
      throw new Error(`${this.name} provider error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

/**
 * Anthropic Provider — API nativa Messages (POST /v1/messages).
 *
 * Diferente do formato OpenAI-compatible: header `x-api-key` (não
 * Authorization Bearer), `anthropic-version` obrigatório, `system` separado
 * do array `messages`, e `max_tokens` obrigatório. Resposta vem em
 * `content[]` (blocos tipados) em vez de `choices[0].message.content`.
 */
export class AnthropicProvider implements ILLMProvider {
  name: LLMProvider = 'ANTHROPIC';
  private apiKey: string | undefined;
  private defaultModel: string | undefined;
  private readonly endpoint: string;
  private readonly apiVersion = '2023-06-01';

  constructor(
    apiKey: string | undefined,
    defaultModel: string | undefined,
    endpoint = 'https://api.anthropic.com/v1/messages'
  ) {
    this.apiKey = apiKey;
    this.defaultModel = defaultModel;
    this.endpoint = endpoint;
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  async chat(messages: LLMMessage[], config?: Partial<LLMConfig>): Promise<LLMResponse> {
    if (!this.isConfigured() || !this.apiKey) {
      throw new Error('ANTHROPIC API key not configured');
    }

    const model = config?.model || this.defaultModel;
    if (!model) {
      throw new Error('ANTHROPIC provider error: nenhum modelo configurado');
    }

    // max_tokens é obrigatório na API nativa da Anthropic — validado aqui
    // mesmo que o schema HTTP já garanta um inteiro positivo.
    const maxTokens = config?.maxTokens ?? 2000;
    if (!Number.isInteger(maxTokens) || maxTokens <= 0) {
      throw new Error('ANTHROPIC provider error: max_tokens inválido');
    }
    const timeoutMs = resolveTimeoutMs(config?.timeoutMs);

    // `system` separado do array `messages` — a API nativa não aceita role "system" ali.
    const systemText = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    const conversation = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role, content: m.content }));

    if (conversation.length === 0) {
      throw new Error('ANTHROPIC provider error: nenhuma mensagem de usuário/assistente para enviar');
    }

    const body: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
      messages: conversation,
    };
    if (systemText) body.system = systemText;
    if (typeof config?.temperature === 'number' && Number.isFinite(config.temperature)) {
      // API da Anthropic aceita 0..1; o schema do cliente permite até 2 (compat OpenAI) — clampa defensivamente.
      body.temperature = Math.min(Math.max(config.temperature, 0), 1);
    }

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': this.apiVersion,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => null);
        const message =
          typeof errBody?.error?.message === 'string' ? errBody.error.message : response.statusText;
        throw new Error(`ANTHROPIC API error: ${message}`);
      }

      const data = await response.json().catch(() => null);
      const blocks = Array.isArray(data?.content) ? data.content : [];
      const content = blocks
        .filter((b: unknown): b is { type: string; text: string } => {
          return (
            !!b &&
            typeof b === 'object' &&
            (b as { type?: unknown }).type === 'text' &&
            typeof (b as { text?: unknown }).text === 'string'
          );
        })
        .map((b: { text: string }) => b.text)
        .join('');

      if (!content) {
        throw new Error('ANTHROPIC resposta malformada: nenhum bloco de texto em content[]');
      }

      const inputTokens = typeof data?.usage?.input_tokens === 'number' ? data.usage.input_tokens : 0;
      const outputTokens = typeof data?.usage?.output_tokens === 'number' ? data.usage.output_tokens : 0;

      return {
        content,
        provider: this.name,
        model,
        usage: {
          promptTokens: inputTokens,
          completionTokens: outputTokens,
          totalTokens: inputTokens + outputTokens,
        },
      };
    } catch (error) {
      if (isAbortLike(error)) {
        throw new Error(`ANTHROPIC provider error: timeout após ${timeoutMs}ms sem resposta do provedor`);
      }
      throw new Error(`ANTHROPIC provider error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

/**
 * Ollama Provider (local) — endpoint vem exclusivamente da allowlist
 * server-side (getOllamaEndpoint), nunca do cliente.
 */
export class OllamaProvider implements ILLMProvider {
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
    const timeoutMs = resolveTimeoutMs(config?.timeoutMs);

    try {
      // num_ctx 8192: contexto padrão de modelos recentes (256k) infla o KV
      // cache além da VRAM de GPUs de 8 GB e derruba o modelo para CPU
      // (validado: 125s -> 1s numa RTX 4060). think:false desliga o
      // raciocínio interno de modelos thinking (qwen3.5 etc.) — minutos de
      // tokens invisíveis por resposta; modelos sem suporte podem rejeitar o
      // campo, então há retry sem ele.
      const basePayload = {
        model,
        messages,
        stream: false,
        options: { num_ctx: 8192 },
      };

      let response = await fetch(`${this.endpoint}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...basePayload, think: false }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok && (response.status === 400 || response.status === 422)) {
        response = await fetch(`${this.endpoint}/api/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(basePayload),
          signal: AbortSignal.timeout(timeoutMs),
        });
      }

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
      if (isAbortLike(error)) {
        throw new Error(`Ollama provider error: timeout após ${timeoutMs}ms sem resposta do provedor`);
      }
      throw new Error(`Ollama provider error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

/**
 * Descoberta de modelos do LM Studio via GET {endpoint}/models
 * (API OpenAI-compatible). Mesma allowlist local do endpoint — nunca aceita
 * host arbitrário. Falha silenciosa (lista vazia) quando o servidor local
 * não responde, igual ao comportamento já existente para Ollama.
 */
export async function discoverLmStudioModels(endpoint: string): Promise<string[]> {
  if (!isAllowedLocalUrl(endpoint)) return [];
  try {
    const res = await fetch(`${endpoint.replace(/\/+$/, '')}/models`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: Array<{ id?: unknown }> };
    const list = Array.isArray(data?.data) ? data.data : [];
    return list
      .map((m) => (typeof m?.id === 'string' ? m.id : null))
      .filter((id): id is string => !!id)
      .sort();
  } catch {
    return [];
  }
}

function buildOpenRouterHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Title': process.env.OPENROUTER_APP_TITLE?.trim() || 'WR Trading Pro',
  };
  const referer = process.env.OPENROUTER_HTTP_REFERER?.trim();
  if (referer) headers['HTTP-Referer'] = referer;
  return headers;
}

/**
 * Orquestrador server-side com fallback entre provedores configurados.
 *
 * Os providers são reconstruídos a cada chamada a partir da credencial
 * efetiva atual (persistência segura + .env) — isso garante que uma
 * configuração salva pela UI de Configurações de IA entra em vigor no
 * próximo request, sem exigir reinício do processo.
 */
class ServerLLMService {
  private fallbackOrder: LLMProvider[] = [
    'OPENAI',
    'ANTHROPIC',
    'DEEPSEEK',
    'OPENROUTER',
    'GROQ',
    'QWEN',
    'LM_STUDIO',
    'OLLAMA',
    'MANUS',
  ];

  private async buildProviders(): Promise<Map<LLMProvider, ILLMProvider>> {
    const providers = new Map<LLMProvider, ILLMProvider>();

    const [openai, deepseek, openrouter, anthropic, lmStudio] = await Promise.all([
      resolveProviderCredential('OPENAI'),
      resolveProviderCredential('DEEPSEEK'),
      resolveProviderCredential('OPENROUTER'),
      resolveProviderCredential('ANTHROPIC'),
      resolveProviderCredential('LM_STUDIO'),
    ]);
    const keys = getServerLlmKeys();

    if (openai.apiKey) {
      providers.set(
        'OPENAI',
        new OpenAICompatibleProvider('OPENAI', openai.apiKey, 'https://api.openai.com/v1/chat/completions', openai.model, 0.1)
      );
    }
    if (deepseek.apiKey) {
      providers.set(
        'DEEPSEEK',
        new OpenAICompatibleProvider(
          'DEEPSEEK',
          deepseek.apiKey,
          'https://api.deepseek.com/v1/chat/completions',
          deepseek.model,
          0.1
        )
      );
    }
    if (openrouter.apiKey) {
      providers.set(
        'OPENROUTER',
        new OpenAICompatibleProvider(
          'OPENROUTER',
          openrouter.apiKey,
          'https://openrouter.ai/api/v1/chat/completions',
          openrouter.model,
          0.3,
          buildOpenRouterHeaders()
        )
      );
    }
    if (anthropic.apiKey) {
      providers.set('ANTHROPIC', new AnthropicProvider(anthropic.apiKey, anthropic.model));
    }
    if (keys.qwen) {
      providers.set(
        'QWEN',
        new OpenAICompatibleProvider(
          'QWEN',
          keys.qwen,
          'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
          'qwen-turbo'
        )
      );
    }
    if (keys.groq) {
      providers.set(
        'GROQ',
        new OpenAICompatibleProvider('GROQ', keys.groq, 'https://api.groq.com/openai/v1/chat/completions', 'llama-3.3-70b-versatile')
      );
    }
    if (keys.manus) {
      providers.set('MANUS', new OpenAICompatibleProvider('MANUS', keys.manus, 'https://api.manus.ai/v1/chat/completions', 'manus-1'));
    }

    // LM Studio e Ollama são locais: sempre registrados via endpoint com
    // default seguro (allowlist loopback), igual ao comportamento pré-existente
    // do Ollama — "configurado" não depende de reachability, só de endpoint válido.
    providers.set(
      'LM_STUDIO',
      new OpenAICompatibleProvider(
        'LM_STUDIO',
        lmStudio.apiKey,
        `${lmStudio.endpoint}/chat/completions`,
        lmStudio.model,
        0.3,
        {},
        false
      )
    );
    providers.set('OLLAMA', new OllamaProvider(getOllamaEndpoint()));

    return providers;
  }

  async getAvailableProviders(): Promise<LLMProvider[]> {
    const providers = await this.buildProviders();
    return Array.from(providers.keys());
  }

  async isProviderConfigured(provider: LLMProvider): Promise<boolean> {
    const providers = await this.buildProviders();
    const p = providers.get(provider);
    return p ? p.isConfigured() : false;
  }

  async chat(request: LLMChatRequest): Promise<LLMResponse> {
    const { messages, config, context } = request;
    const providers = await this.buildProviders();

    let enhancedMessages = [...messages];
    if (context) {
      const systemMessage = this.buildSystemMessage(context);
      enhancedMessages = [systemMessage, ...messages];
    }

    const preferredProvider = config?.provider || this.fallbackOrder[0];

    const preferred = providers.get(preferredProvider);
    if (preferred?.isConfigured()) {
      try {
        return await preferred.chat(enhancedMessages, config);
      } catch (error) {
        console.error(`Provider ${preferredProvider} failed:`, error);
      }
    }

    for (const providerName of this.fallbackOrder) {
      if (providerName === preferredProvider) continue;

      const provider = providers.get(providerName);
      if (provider?.isConfigured()) {
        try {
          console.log(`Falling back to ${providerName}`);
          return await provider.chat(enhancedMessages, config);
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
      const m = context.market as LLMMarketContext;
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
