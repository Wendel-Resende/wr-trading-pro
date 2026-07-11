import { TConnectorState } from '@/types/profit/enums';

import type * as ProfitTypes from '@/types/profit';
export interface ProfitDllCallbacks {
  onStateChange?: (state: TConnectorState) => void;
  onNewTrade?: (trade: ProfitTypes.TConnectorTrade) => void;
  onNewDaily?: (candle: ProfitTypes.TNewDailyData) => void;
  onOrderChange?: (order: ProfitTypes.TConnectorOrder) => void;
  onPriceDepth?: (depth: ProfitTypes.TConnectorPriceDepth) => void;
  onTradingMessage?: (result: ProfitTypes.TConnectorTradingMessageResult) => void;
  onTheoreticalPrice?: (data: ProfitTypes.TTheoreticalPriceData) => void;
  onAssetListInfo?: (info: ProfitTypes.TAssetListInfo) => void;
  onHistoryCallback?: (data: ProfitTypes.TConnectorOrderHistoryData | ProfitTypes.TConnectorTradeHistoryData) => void;
  onAdjustHistory?: (data: ProfitTypes.TAdjustHistoryCallbackV2) => void;
  onChangeStateTicker?: (ticker: string, state: number) => void;
}

export interface ProfitDllConfig {
  dllPath?: string;
  userId: string;
  password: string;
  activationKey: string;
  callbacks: ProfitDllCallbacks;
}

export interface ProfitConnectionStatus {
  state: TConnectorState;
  connectedAt?: Date;
  lastError?: string;
}

export class ProfitDllService {
  private config: ProfitDllConfig | null = null;
  private status: ProfitConnectionStatus = { state: TConnectorState.Disconnected };
  private subscribedTickers = new Set<string>();

  constructor() {}

  async initialize(config: ProfitDllConfig): Promise<void> {
    this.config = config;
  }

  async connect(): Promise<void> {
    if (!this.config) throw new Error('ProfitDllService not initialized');
  }

  async disconnect(): Promise<void> {
    this.status = { state: TConnectorState.Disconnected };
  }

  async subscribeTicker(ticker: string): Promise<void> {
    if (!this.config) throw new Error('Not connected');
    this.subscribedTickers.add(ticker);
  }

  async unsubscribeTicker(ticker: string): Promise<void> {
    this.subscribedTickers.delete(ticker);
  }

  async getStatus(): Promise<ProfitConnectionStatus> {
    return this.status;
  }

  async sendOrder(order: ProfitTypes.TConnectorOrder): Promise<ProfitTypes.TConnectorTradingMessageResult> {
    throw new Error('Not implemented - requires active connection');
  }

  async cancelOrder(orderId: string): Promise<ProfitTypes.TConnectorTradingMessageResult> {
    throw new Error('Not implemented - requires active connection');
  }

  async getPosition(asset: string): Promise<ProfitTypes.TConnectorPosition | null> {
    return null;
  }

  async getAccountDetails(): Promise<ProfitTypes.TConnectorAccountDetails | null> {
    return null;
  }

  isConnected(): boolean {
    return this.status.state === TConnectorState.Authenticated;
  }
}

export const profitDllService = new ProfitDllService();
