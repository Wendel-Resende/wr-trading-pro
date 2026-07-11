/**
 * Trading Agents Service
 * Conecta com /api/agents para análise de trading
 */

import { MT5Tick } from '@/types/mt5';

export interface MarketData {
  price: number;
  bid: number;
  ask: number;
  previousClose: number;
}

export interface OperationSuggestion {
  action: 'BUY' | 'SELL' | 'HOLD';
  ticker: string;
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  quantity: number;
  risk_score: number;
  confidence: number;
  rationale: string;
  timestamp: string;
}

/**
 * Trading Agents Service
 */
class TradingAgentsService {
  async getMarketData(_symbol: string): Promise<MarketData> {
    // Return default data - in production would connect to MT5 WebSocket
    // For now, API returns mock data
    return { price: 38.50, bid: 38.45, ask: 38.55, previousClose: 38.20 };
  }

  async suggestOperation(
    ticker: string,
    thesis: string,
    marketData?: MarketData,
    apiKey?: string,
    llmMode?: string,
    localUrl?: string
  ): Promise<OperationSuggestion> {
    const response = await fetch('/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'suggest-operation',
        ticker,
        thesis,
        market_data: marketData,
        api_key: apiKey,
        llm_mode: llmMode,
        local_url: localUrl,
      }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.error || 'Unknown error');
    }

    return result.data;
  }
}

export const tradingAgentsService = new TradingAgentsService();