import {
  ProfitDLLConfig,
  ProfitDLLConnectionState,
  ProfitDLLTrade,
  ProfitDLLPriceDepth,
  ProfitDLLOfferBook,
  ProfitDLLDailyData,
  ProfitDLLPosition,
  ProfitDLLOrder,
  ProfitDLLAccount,
  ProfitDLLAsset,
  ProfitDLLWebSocketMessage,
} from '@/types/profitDLL';

/**
 * ProfitDLL Service - Bridge para comunicação com servidor Python
 * 
 * Este serviço se comunica com um servidor Python que faz a ponte
 * com a DLL do ProfitDLL (Nelogica Data Solutions)
 */
class ProfitDLLService {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 3000;
  private connectionState: ProfitDLLConnectionState = {
    state: 'DISCONNECTED',
    isConnected: false,
    isMarketConnected: false,
    isActivated: false,
  };
  private listeners: Map<string, Set<(data: any) => void>> = new Map();
  private pythonServerUrl: string = 'ws://localhost:8765';

  constructor() {
    this.loadConfig();
  }

  /**
   * Carregar configuração do localStorage
   */
  private loadConfig() {
    // Verificar se está no ambiente do navegador
    if (typeof window === 'undefined') {
      return;
    }
    
    const config = localStorage.getItem('profitdll-config');
    if (config) {
      try {
        const parsed = JSON.parse(config);
        this.pythonServerUrl = parsed.pythonServerUrl || 'ws://localhost:8765';
      } catch (error) {
        console.error('Failed to load ProfitDLL config:', error);
      }
    }
  }

  /**
   * Obter estado atual da conexão
   */
  getConnectionState(): ProfitDLLConnectionState {
    return { ...this.connectionState };
  }

  /**
   * Conectar ao servidor Python do ProfitDLL
   */
  async connect(config?: Partial<ProfitDLLConfig>): Promise<boolean> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log('ProfitDLL already connected');
      return true;
    }

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.pythonServerUrl);

        this.ws.onopen = () => {
          console.log('ProfitDLL WebSocket connected');
          this.connectionState.state = 'CONNECTING';
          this.connectionState.isConnected = true;
          this.emit('state', this.connectionState);

          // Enviar configuração de login se fornecida
          if (config) {
            this.sendLogin(config);
          }

          resolve(true);
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.ws.onerror = (error) => {
          console.error('ProfitDLL WebSocket error:', error);
          this.connectionState.state = 'ERROR';
          this.connectionState.lastError = 'WebSocket connection error';
          this.emit('state', this.connectionState);
          reject(error);
        };

        this.ws.onclose = () => {
          console.log('ProfitDLL WebSocket closed');
          this.connectionState.state = 'DISCONNECTED';
          this.connectionState.isConnected = false;
          this.connectionState.isMarketConnected = false;
          this.connectionState.isActivated = false;
          this.emit('state', this.connectionState);

          // Tentar reconectar automaticamente
          if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            setTimeout(() => {
              console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
              this.connect();
            }, this.reconnectDelay);
          }
        };
      } catch (error) {
        console.error('Failed to connect to ProfitDLL:', error);
        this.connectionState.state = 'ERROR';
        this.connectionState.lastError = error instanceof Error ? error.message : 'Unknown error';
        this.emit('state', this.connectionState);
        reject(error);
      }
    });
  }

  /**
   * Desconectar do servidor Python
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.reconnectAttempts = 0;
  }

  /**
   * Enviar comando de login para o servidor Python
   */
  private sendLogin(config: Partial<ProfitDLLConfig>): void {
    const message = {
      type: 'LOGIN',
      data: {
        accessKey: config.accessKey,
        username: config.username,
        password: config.password,
        enableRouting: config.enableRouting ?? true,
      },
    };
    this.send(message);
  }

  /**
   * Enviar mensagem para o servidor Python
   */
  private send(message: any): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.error('Cannot send message: WebSocket not connected');
    }
  }

  /**
   * Processar mensagem recebida do servidor Python
   */
  private handleMessage(data: string): void {
    try {
      const message: ProfitDLLWebSocketMessage = JSON.parse(data);
      
      switch (message.type) {
        case 'STATE':
          this.handleStateMessage(message.data);
          break;
        case 'TRADE':
          this.handleTradeMessage(message.data);
          break;
        case 'PRICE_DEPTH':
          this.handlePriceDepthMessage(message.data);
          break;
        case 'OFFER_BOOK':
          this.handleOfferBookMessage(message.data);
          break;
        case 'DAILY':
          this.handleDailyMessage(message.data);
          break;
        case 'ORDER':
          this.handleOrderMessage(message.data);
          break;
        case 'POSITION':
          this.handlePositionMessage(message.data);
          break;
        case 'ACCOUNT':
          this.handleAccountMessage(message.data);
          break;
        case 'ERROR':
          this.handleErrorMessage(message.data);
          break;
        default:
          console.warn('Unknown message type:', message.type);
      }
    } catch (error) {
      console.error('Failed to parse ProfitDLL message:', error);
    }
  }

  /**
   * Processar mensagem de estado
   */
  private handleStateMessage(data: any): void {
    this.connectionState = {
      ...this.connectionState,
      state: data.state || 'CONNECTED',
      isMarketConnected: data.isMarketConnected ?? false,
      isActivated: data.isActivated ?? false,
    };
    this.emit('state', this.connectionState);
  }

  /**
   * Processar mensagem de trade
   */
  private handleTradeMessage(data: any): void {
    const trade: ProfitDLLTrade = {
      assetId: data.assetId,
      date: new Date(data.date),
      tradeNumber: data.tradeNumber,
      price: data.price,
      quantity: data.quantity,
      volume: data.volume,
      buyAgent: data.buyAgent,
      sellAgent: data.sellAgent,
      tradeType: data.tradeType,
      isEdit: data.isEdit ?? false,
    };
    this.emit('trade', trade);
  }

  /**
   * Processar mensagem de price depth
   */
  private handlePriceDepthMessage(data: any): void {
    const priceDepth: ProfitDLLPriceDepth = {
      assetId: data.assetId,
      side: data.side,
      position: data.position,
      updateType: data.updateType,
      priceGroup: data.priceGroup,
    };
    this.emit('priceDepth', priceDepth);
  }

  /**
   * Processar mensagem de offer book
   */
  private handleOfferBookMessage(data: any): void {
    const offerBook: ProfitDLLOfferBook = {
      assetId: data.assetId,
      action: data.action,
      position: data.position,
      side: data.side,
      quantity: data.quantity,
      agent: data.agent,
      offerId: data.offerId,
      price: data.price,
      hasPrice: data.hasPrice,
      hasQuantity: data.hasQuantity,
      hasDate: data.hasDate,
      hasOfferId: data.hasOfferId,
      hasAgent: data.hasAgent,
      date: data.date ? new Date(data.date) : undefined,
      buyOffers: data.buyOffers || [],
      sellOffers: data.sellOffers || [],
    };
    this.emit('offerBook', offerBook);
  }

  /**
   * Processar mensagem de dados diários
   */
  private handleDailyMessage(data: any): void {
    const daily: ProfitDLLDailyData = {
      assetId: data.assetId,
      date: new Date(data.date),
      open: data.open,
      high: data.high,
      low: data.low,
      close: data.close,
      volume: data.volume,
      adjustment: data.adjustment,
      maxLimit: data.maxLimit,
      minLimit: data.minLimit,
      volumeBuyer: data.volumeBuyer,
      volumeSeller: data.volumeSeller,
      quantity: data.quantity,
      trades: data.trades,
      openContracts: data.openContracts,
      quantityBuyer: data.quantityBuyer,
      quantitySeller: data.quantitySeller,
      tradesBuyer: data.tradesBuyer,
      tradesSeller: data.tradesSeller,
    };
    this.emit('daily', daily);
  }

  /**
   * Processar mensagem de ordem
   */
  private handleOrderMessage(data: any): void {
    const order: ProfitDLLOrder = {
      orderId: data.orderId,
      accountId: data.accountId,
      asset: data.asset,
      quantity: data.quantity,
      tradedQuantity: data.tradedQuantity,
      leavesQuantity: data.leavesQuantity,
      price: data.price,
      stopPrice: data.stopPrice,
      averagePrice: data.averagePrice,
      orderSide: data.orderSide,
      orderType: data.orderType,
      orderStatus: data.orderStatus,
      validityType: data.validityType,
      date: new Date(data.date),
      lastUpdate: new Date(data.lastUpdate),
      closeDate: data.closeDate ? new Date(data.closeDate) : undefined,
      validityDate: data.validityDate ? new Date(data.validityDate) : undefined,
      textMessage: data.textMessage,
      eventId: data.eventId,
    };
    this.emit('order', order);
  }

  /**
   * Processar mensagem de posição
   */
  private handlePositionMessage(data: any): void {
    const position: ProfitDLLPosition = {
      accountId: data.accountId,
      asset: data.asset,
      openQuantity: data.openQuantity,
      openAveragePrice: data.openAveragePrice,
      openSide: data.openSide,
      dailyAverageSellPrice: data.dailyAverageSellPrice,
      dailySellQuantity: data.dailySellQuantity,
      dailyAverageBuyPrice: data.dailyAverageBuyPrice,
      dailyBuyQuantity: data.dailyBuyQuantity,
      dailyQuantity: data.dailyQuantity,
      dailyQuantityAvailable: data.dailyQuantityAvailable,
      positionType: data.positionType,
      eventId: data.eventId,
    };
    this.emit('position', position);
  }

  /**
   * Processar mensagem de conta
   */
  private handleAccountMessage(data: any): void {
    const account: ProfitDLLAccount = {
      brokerId: data.brokerId,
      accountId: data.accountId,
      subAccountId: data.subAccountId,
      brokerName: data.brokerName,
      ownerName: data.ownerName,
      subOwnerName: data.subOwnerName,
      accountType: data.accountType,
    };
    this.emit('account', account);
  }

  /**
   * Processar mensagem de erro
   */
  private handleErrorMessage(data: any): void {
    console.error('ProfitDLL error:', data);
    this.connectionState.lastError = data.message || 'Unknown error';
    this.emit('error', data);
  }

  /**
   * Inscrever em eventos do ProfitDLL
   */
  on(event: string, callback: (data: any) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  /**
   * Remover inscrição de eventos
   */
  off(event: string, callback: (data: any) => void): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.delete(callback);
    }
  }

  /**
   * Emitir evento para listeners
   */
  private emit(event: string, data: any): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach(callback => callback(data));
    }
  }

  /**
   * Inscrever em ticker de ativo
   */
  subscribeTicker(ticker: string, exchange: string = 'B'): void {
    this.send({
      type: 'SUBSCRIBE_TICKER',
      data: { ticker, exchange },
    });
  }

  /**
   * Desinscrever de ticker de ativo
   */
  unsubscribeTicker(ticker: string, exchange: string = 'B'): void {
    this.send({
      type: 'UNSUBSCRIBE_TICKER',
      data: { ticker, exchange },
    });
  }

  /**
   * Inscrever em price depth de ativo
   */
  subscribePriceDepth(ticker: string, exchange: string = 'B'): void {
    this.send({
      type: 'SUBSCRIBE_PRICE_DEPTH',
      data: { ticker, exchange },
    });
  }

  /**
   * Desinscrever de price depth de ativo
   */
  unsubscribePriceDepth(ticker: string, exchange: string = 'B'): void {
    this.send({
      type: 'UNSUBSCRIBE_PRICE_DEPTH',
      data: { ticker, exchange },
    });
  }

  /**
   * Inscrever em offer book de ativo
   */
  subscribeOfferBook(ticker: string, exchange: string = 'B'): void {
    this.send({
      type: 'SUBSCRIBE_OFFER_BOOK',
      data: { ticker, exchange },
    });
  }

  /**
   * Desinscrever de offer book de ativo
   */
  unsubscribeOfferBook(ticker: string, exchange: string = 'B'): void {
    this.send({
      type: 'UNSUBSCRIBE_OFFER_BOOK',
      data: { ticker, exchange },
    });
  }

  /**
   * Obter posição de ativo
   */
  getPosition(accountId: string, ticker: string, exchange: string = 'B'): void {
    this.send({
      type: 'GET_POSITION',
      data: { accountId, ticker, exchange },
    });
  }

  /**
   * Obter ordens
   */
  getOrders(accountId: string, startDate?: Date, endDate?: Date): void {
    this.send({
      type: 'GET_ORDERS',
      data: {
        accountId,
        startDate: startDate?.toISOString(),
        endDate: endDate?.toISOString(),
      },
    });
  }

  /**
   * Enviar ordem de compra
   */
  sendBuyOrder(
    accountId: string,
    ticker: string,
    exchange: string,
    quantity: number,
    price?: number,
    orderType: 'MARKET' | 'LIMIT' | 'STOP' = 'MARKET',
    stopPrice?: number
  ): void {
    this.send({
      type: 'SEND_BUY_ORDER',
      data: {
        accountId,
        ticker,
        exchange,
        quantity,
        price,
        orderType,
        stopPrice,
      },
    });
  }

  /**
   * Enviar ordem de venda
   */
  sendSellOrder(
    accountId: string,
    ticker: string,
    exchange: string,
    quantity: number,
    price?: number,
    orderType: 'MARKET' | 'LIMIT' | 'STOP' = 'MARKET',
    stopPrice?: number
  ): void {
    this.send({
      type: 'SEND_SELL_ORDER',
      data: {
        accountId,
        ticker,
        exchange,
        quantity,
        price,
        orderType,
        stopPrice,
      },
    });
  }

  /**
   * Cancelar ordem
   */
  cancelOrder(accountId: string, clOrderId: string): void {
    this.send({
      type: 'CANCEL_ORDER',
      data: { accountId, clOrderId },
    });
  }

  /**
   * Cancelar todas as ordens
   */
  cancelAllOrders(accountId: string): void {
    this.send({
      type: 'CANCEL_ALL_ORDERS',
      data: { accountId },
    });
  }

  /**
   * Zerar posição
   */
  zeroPosition(accountId: string, ticker: string, exchange: string, positionType: 'DAYTRADE' | 'CONSOLIDATED'): void {
    this.send({
      type: 'ZERO_POSITION',
      data: { accountId, ticker, exchange, positionType },
    });
  }
}

// Export singleton instance
export const profitDLLService = new ProfitDLLService();
export default ProfitDLLService;
