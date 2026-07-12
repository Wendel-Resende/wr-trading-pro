/**
 * LLM Service (client-side) - WR Trading Pro
 *
 * Cliente fino do proxy /api/llm/chat. Nenhuma chave de API ou endpoint de
 * provedor vive no frontend: credenciais e endpoint Ollama são configurados
 * exclusivamente no servidor (ver src/lib/server/llm-config.ts e .env).
 */

import { LLMProvider, LLMResponse, LLMChatRequest } from '@/types/llm';

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
 * LLM Service - proxy client for the server-side LLM route
 */
class LLMService {
  private readonly proxyUrl = '/api/llm/chat';

  /**
   * Providers configurados no servidor (nomes apenas, sem segredos).
   */
  async getAvailableProviders(): Promise<LLMProvider[]> {
    try {
      const response = await fetch(this.proxyUrl);
      if (!response.ok) return [];
      const result = await response.json();
      return result?.data?.providers ?? [];
    } catch {
      return [];
    }
  }

  /**
   * Chat via proxy server-side (fallback entre provedores acontece no backend).
   */
  async chat(request: LLMChatRequest): Promise<LLMResponse> {
    const response = await fetch(this.proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    const result = await response.json().catch(() => null);

    if (!response.ok || !result?.success) {
      throw new Error(result?.error || `LLM proxy error: ${response.status}`);
    }

    return result.data as LLMResponse;
  }
}

// Export singleton instance
export const llmService = new LLMService();
export default LLMService;
