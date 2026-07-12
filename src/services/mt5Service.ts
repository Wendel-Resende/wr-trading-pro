import {
  MT5Config,
  MT5ConnectionStatus,
  MT5AccountInfo,
  MT5Position,
  MT5Order,
  MT5Trade,
  MT5Tick,
  MT5SymbolInfo,
  MT5OrderRequest,
  MT5OrderResult,
  MT5WebSocketMessage,
  MT5Candle,
  MT5ChartData,
} from '@/types/mt5';
import { redactedString } from '@/lib/redact';

/**
 * MetaTrader 5 Service - Bridge para comunicação com servidor Python
 * 
 * Este serviço se comunica com um servidor Python que faz a ponte
 * com a API oficial do MetaTrader 5
 */
class MT5Service {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 3000;
  private connectionState: MT5ConnectionStatus = {
    state: 'DISCONNECTED',
    isConnected: false,
  };
  private listeners: Map<string, Set<(data: any) => void>> = new Map();
  private pythonServerUrl: string = 'ws://localhost:8766';
  private lastConfig: MT5Config | null = null;
  // Serializa tentativas concorrentes e distingue socket aberto de autenticado.
  private connectPromise: Promise<boolean> | null = null;
  private wsAuthenticated = false;
  private connectionGeneration = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private chartRequestId = 0;

  // Timeouts do handshake de autenticação do bridge (Fase 0, Item 10)
  private readonly WS_TOKEN_FETCH_TIMEOUT_MS = 5000;
  private readonly WS_AUTH_TIMEOUT_MS = 5000;

  // Cache de dados para manter estado entre remontagens de componentes
  private ordersCache: Map<number, MT5Order> = new Map();
  private tradesCache: Map<number, MT5Trade> = new Map();
  private positionsCache: Map<number, MT5Position> = new Map();
  private subscribedSymbols: Set<string> = new Set();
  private subscribedOrderBooks: Set<string> = new Set(); // Símbolos com book inscrito
  private initialDailyBalance: number = 0; // Saldo inicial do dia para calcular resultado diário

  private readonly NON_FATAL_ERROR_CODES = new Set([
    'SEND_FAILED', 'VOLUME_TOO_SMALL', 'NO_PRICE', 'CHART_DATA_ERROR',
    'CHART_RANGE_ERROR', 'CHART_TIMEFRAME_ERROR', 'NOT_CONNECTED',
    'HISTORY_ERROR', 'SYMBOL_INFO_ERROR', 'SYMBOL_NOT_FOUND',
  ]);
  private readonly NON_FATAL_ERROR_SUBSTRINGS = [
    'Terminal: Call failed',
    'Erro ao obter dados de gráfico',
  ];

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
    
    const config = localStorage.getItem('mt5-config');
    if (config) {
      try {
        const parsed = JSON.parse(config);
        this.pythonServerUrl = parsed.pythonServerUrl || 'ws://localhost:8766';
      } catch (error) {
        console.error('Failed to load MT5 config:', error);
      }
    }
  }

  /**
   * Obter estado atual da conexão
   */
  getConnectionState(): MT5ConnectionStatus {
    console.log('[MT5 SERVICE] getConnectionState chamado - Estado:', this.connectionState.state, 'WebSocket:', this.ws?.readyState);
    return { ...this.connectionState };
  }

  /**
   * Obter estado do WebSocket (para sincronização de estado)
   */
  getWebSocketReadyState(): number | undefined {
    const readyState = this.ws?.readyState;
    console.log('[MT5 SERVICE] getWebSocketReadyState chamado - readyState:', readyState, 'this.ws:', this.ws);
    return readyState;
  }

  /**
   * Busca um token efêmero de uso único para o handshake do WebSocket.
   * A sessão vem do cookie HttpOnly (credentials same-origin); o token nunca
   * é logado, guardado em localStorage nem colocado na URL do WebSocket.
   */
  private async fetchWsToken(): Promise<string> {
    let response: Response;
    try {
      response = await fetch('/api/auth/ws-token', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.timeout(this.WS_TOKEN_FETCH_TIMEOUT_MS),
      });
    } catch {
      throw new Error('Falha ao obter token de autenticação do MT5 Bridge');
    }

    if (response.status === 401) {
      throw new Error('Sessão expirada — faça login novamente para conectar ao MT5');
    }
    if (response.status === 503) {
      throw new Error('Autenticação do MT5 Bridge não configurada no servidor');
    }
    if (!response.ok) {
      throw new Error(`Falha ao obter token de autenticação (HTTP ${response.status})`);
    }

    const body = await response.json().catch(() => null);
    if (!body || typeof body.token !== 'string' || body.token.length === 0) {
      throw new Error('Resposta inválida ao obter token de autenticação');
    }
    return body.token;
  }

  /**
   * Conectar ao servidor Python do MT5. Chamadas concorrentes compartilham a
   * mesma Promise para impedir que um AUTH_OK de um socket resolva outro.
   */
  async connect(config?: Partial<MT5Config>): Promise<boolean> {
    if (
      this.ws?.readyState === WebSocket.OPEN &&
      this.wsAuthenticated
    ) {
      return true;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const attempt = this.connectInternal(config);
    this.connectPromise = attempt;
    try {
      return await attempt;
    } finally {
      if (this.connectPromise === attempt) {
        this.connectPromise = null;
      }
    }
  }

  private async connectInternal(config?: Partial<MT5Config>): Promise<boolean> {
    const generation = this.connectionGeneration;
    // Zerar this.ws antes de fechar o socket antigo garante que o onclose
    // dele não toque no estado da nova tentativa nem feche o socket novo.
    const oldWs = this.ws;
    if (oldWs && oldWs.readyState !== WebSocket.CLOSED) {
      this.ws = null;
      oldWs.close();
    }
    this.wsAuthenticated = false;

    if (config && (config.login || config.password || config.server)) {
      this.lastConfig = config as MT5Config;
    }

    // eslint-disable-next-line no-console
    console.log('Tentando conectar ao MT5 Bridge:', this.pythonServerUrl);

    // Token novo a cada (re)conexão — é de uso único e expira em segundos
    let wsToken: string;
    try {
      wsToken = await this.fetchWsToken();
    } catch (error) {
      if (generation !== this.connectionGeneration) {
        throw new Error('Conexão com o MT5 cancelada');
      }
      const message = error instanceof Error ? error.message : 'Falha ao obter token de autenticação';
      // eslint-disable-next-line no-console
      console.warn('MT5:', message);
      this.connectionState.state = 'ERROR';
      this.connectionState.isConnected = false;
      this.connectionState.lastError = message;
      this.emit('state', this.connectionState);
      throw error;
    }

    // disconnect() pode ocorrer enquanto fetchWsToken() aguarda a rede.
    if (generation !== this.connectionGeneration) {
      throw new Error('Conexão com o MT5 cancelada');
    }

    return new Promise((resolve, reject) => {
      let socket: WebSocket;
      try {
        socket = new WebSocket(this.pythonServerUrl);
        this.ws = socket;
      } catch (error) {
        this.connectionState.state = 'ERROR';
        this.connectionState.isConnected = false;
        this.connectionState.lastError = error instanceof Error ? error.message : 'Unknown error';
        this.emit('state', this.connectionState);
        reject(error);
        return;
      }

      let settled = false;
      let authTimer: ReturnType<typeof setTimeout> | null = null;

      const clearAuthTimer = () => {
        if (authTimer) {
          clearTimeout(authTimer);
          authTimer = null;
        }
      };

      const failBeforeAuth = (message: string) => {
        if (settled) return;
        settled = true;
        clearAuthTimer();
        if (this.ws === socket) {
          this.wsAuthenticated = false;
          this.connectionState.state = 'ERROR';
          this.connectionState.isConnected = false;
          this.connectionState.lastError = message;
          this.emit('state', this.connectionState);
        }
        try {
          socket.close();
        } catch {
          // socket já fechado
        }
        reject(new Error(message));
      };

      const completeAuth = () => {
        if (settled || this.ws !== socket) return;
        settled = true;
        clearAuthTimer();
        this.wsAuthenticated = true;
        this.reconnectAttempts = 0;

        // eslint-disable-next-line no-console
        console.log('MT5 WebSocket conectado e autenticado');
        this.connectionState.state = 'CONNECTING';
        this.connectionState.isConnected = true;
        this.emit('state', this.connectionState);

        // Só enviar LOGIN depois do AUTH_OK
        if (config) {
          this.sendLogin(config);
        } else {
          // eslint-disable-next-line no-console
          console.warn('Nenhuma configuração fornecida para login');
        }
        resolve(true);
      };

      socket.onopen = () => {
        // Primeira mensagem obrigatória: AUTH com token efêmero. Envio direto
        // para nunca passar pelo logger de send().
        socket.send(JSON.stringify({ type: 'AUTH', data: { token: wsToken } }));
        authTimer = setTimeout(
          () => failBeforeAuth('Timeout na autenticação do MT5 Bridge'),
          this.WS_AUTH_TIMEOUT_MS
        );
      };

      socket.onmessage = (event) => {
        if (!settled) {
          try {
            const message = JSON.parse(event.data as string) as { type?: string };
            if (message.type === 'AUTH_OK') {
              completeAuth();
              return;
            }
          } catch {
            failBeforeAuth('Resposta inválida durante autenticação do MT5 Bridge');
            return;
          }
          failBeforeAuth('MT5 Bridge respondeu antes de confirmar autenticação');
          return;
        }

        this.handleMessage(event.data);
      };

      socket.onerror = () => {
        if (!settled) {
          failBeforeAuth('WebSocket connection error');
        }
      };

      socket.onclose = () => {
        clearAuthTimer();
        const wasAuthenticated = this.ws === socket && this.wsAuthenticated;
        if (!settled) {
          settled = true;
          reject(new Error('Conexão fechada antes da autenticação com o MT5 Bridge'));
        }

        // Eventos atrasados de socket antigo não podem alterar a tentativa atual.
        if (this.ws !== socket) return;

        this.ws = null;
        this.wsAuthenticated = false;
        this.connectionState.isConnected = false;

        // Falha de autenticação permanece ERROR e não entra em retry automático.
        if (!wasAuthenticated) {
          if (this.connectionState.state !== 'ERROR') {
            this.connectionState.state = 'ERROR';
            this.connectionState.lastError = 'Conexão fechada antes da autenticação com o MT5 Bridge';
            this.emit('state', this.connectionState);
          }
          return;
        }

        const wasManualDisconnect = this.reconnectAttempts > this.maxReconnectAttempts;
        this.connectionState.state = 'DISCONNECTED';
        this.emit('state', this.connectionState);

        if (!wasManualDisconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          const reconnectGeneration = this.connectionGeneration;
          this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (reconnectGeneration !== this.connectionGeneration) return;
            this.connect(this.lastConfig ?? undefined).catch((err) => {
              // eslint-disable-next-line no-console
              console.warn('Reconexão MT5 falhou:', err instanceof Error ? err.message : err);
            });
          }, this.reconnectDelay);
        }
      };
    });
  }

  /**
   * Desconectar do servidor Python
   */
  disconnect(): void {
    // Invalida fetch/handshake pendente e qualquer reconexão já agendada.
    this.connectionGeneration++;
    this.reconnectAttempts = this.maxReconnectAttempts + 1;
    this.wsAuthenticated = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Permite uma nova conexão manual; a tentativa antiga continuará vinculada
    // à geração anterior e não poderá criar/autenticar um novo socket.
    this.connectPromise = null;

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.connectionState.state = 'DISCONNECTED';
    this.connectionState.isConnected = false;
    this.connectionState.lastError = undefined;
    this.emit('state', this.connectionState);

    // Limpar caches ao desconectar
    this.ordersCache.clear();
    this.tradesCache.clear();
    this.positionsCache.clear();
    this.subscribedSymbols.clear();
    this.initialDailyBalance = 0;
  }

  /**
   * Obter ordens em cache
   */
  getOrdersCache(): MT5Order[] {
    return Array.from(this.ordersCache.values());
  }

  /**
   * Obter trades em cache
   */
  getTradesCache(): MT5Trade[] {
    return Array.from(this.tradesCache.values());
  }

  /**
   * Obter posições em cache
   */
  getPositionsCache(): MT5Position[] {
    return Array.from(this.positionsCache.values());
  }

  /**
   * Obter saldo inicial do dia
   */
  getInitialDailyBalance(): number {
    return this.initialDailyBalance;
  }

  /**
   * Enviar comando de login para o servidor Python
   */
  private sendLogin(config: Partial<MT5Config>): void {
    const loginNumber = config.login ? Number(config.login) : undefined;
    const message = {
      type: 'LOGIN',
      data: {
        login: loginNumber,
        password: config.password,
        server: config.server,
        path: config.path,
      },
    };
    // eslint-disable-next-line no-console
    console.log('Enviando mensagem LOGIN:', {
      type: message.type,
      login: loginNumber,
      server: config.server,
      hasPassword: !!config.password,
    });
    this.send(message);
  }

  /**
   * Enviar mensagem para o servidor Python
   */
  send(message: any): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      const jsonMessage = JSON.stringify(message);
      // eslint-disable-next-line no-console
      console.log('Enviando mensagem:', redactedString(message));
      this.ws.send(jsonMessage);
    } else if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.warn('MT5: send() skipped — WebSocket not connected. ReadyState:', this.ws?.readyState);
    }
  }

  /**
   * Processar mensagem recebida do servidor Python
   */
  private handleMessage(data: string): void {
    try {
      const message: MT5WebSocketMessage = JSON.parse(data);
      
      // Ignorar mensagens sem tipo ou com tipo inválido
      if (!message.type) {
        // eslint-disable-next-line no-console
        console.warn('Mensagem recebida sem tipo:', data);
        return;
      }
      
      // Ignorar mensagens com data vazio/inválido para ERROR
      if (message.type === 'ERROR') {
        const data = message.data;
        const isEmpty = !data || 
          (typeof data === 'object' && Object.keys(data).length === 0) ||
          (typeof data === 'string' && data.trim() === '');
        if (isEmpty) {
          // eslint-disable-next-line no-console
          console.warn('ERRO VAZIO DETECTADO E BLOQUEADO - mensagem ignorada:', data);
          return;
        }
      }
      
      // Log apenas para mensagens importantes (não TICK que é muito frequente)
      if (message.type !== 'TICK' && message.type !== 'ACCOUNT') {
        // eslint-disable-next-line no-console
        console.log('[MT5 SERVICE] Processando mensagem tipo:', message.type, 'Data:', JSON.stringify(message.data));
      }
      
      switch (message.type) {
        case 'STATE':
          this.handleStateMessage(message.data);
          break;
        case 'TICK':
          this.handleTickMessage(message.data);
          break;
        case 'POSITION':
          this.handlePositionMessage(message.data);
          break;
        case 'ORDER':
          this.handleOrderMessage(message.data);
          break;
        case 'TRADE':
          this.handleTradeMessage(message.data);
          break;
        case 'ACCOUNT':
          this.handleAccountMessage(message.data);
          break;
        case 'ORDER_RESULT':
          this.handleOrderResultMessage(message.data);
          break;
        case 'ORDERBOOK':
          this.handleOrderBookMessage(message.data);
          break;
        case 'CHART_DATA': {
          const chartData = message.data as MT5ChartData;
          const requestId = (chartData as any)?.requestId;
          const emitSymbol = message.symbol ?? chartData?.symbol;
          const emitTimeframe = message.timeframe ?? chartData?.timeframe;
          // eslint-disable-next-line no-console
          console.log('[MT5] Mensagem CHART_DATA recebida:', emitSymbol);
          if (!emitSymbol || !emitTimeframe) {
            // eslint-disable-next-line no-console
            console.warn('[MT5] CHART_DATA missing symbol/timeframe — response will not resolve pending getChartData()');
          }
          const rawCandles = chartData?.candles ?? chartData ?? [];
          const candles: MT5Candle[] = (Array.isArray(rawCandles) ? rawCandles : []).map((c: any) => ({
            time: typeof c.time === 'number' ? c.time : new Date(c.time).getTime() / 1000,
            open: Number(c.open),
            high: Number(c.high),
            low: Number(c.low),
            close: Number(c.close),
            volume: Number(c.volume || c.tick_volume || 0),
          }));
          this.emit('chartData', { requestId, symbol: emitSymbol, timeframe: emitTimeframe, candles });
          break;
        }
        case 'ERROR':
          // Validar e processar mensagem de erro
          const errData = message.data;
          const isEmptyErr = !errData ||
            (typeof errData === 'object' && Object.keys(errData).length === 0) ||
            (typeof errData === 'string' && errData.trim() === '');

          if (isEmptyErr) {
            // eslint-disable-next-line no-console
            console.warn('MT5 error vazio ignorado');
            return;
          }

          // Validar se tem conteúdo útil antes de processar
          let hasValidError = false;
          if (typeof errData === 'string' && errData.trim() !== '') {
            hasValidError = true;
          } else if (typeof errData === 'object' && Object.keys(errData).length > 0) {
            // Verificar se pelo menos uma propriedade tem valor não-vazio
            hasValidError = Object.values(errData).some(val =>
              val !== null && val !== undefined && val !== ''
            );
          }

          if (!hasValidError) {
            // eslint-disable-next-line no-console
            console.warn('MT5 error sem conteúdo válido - ignorando');
            return;
          }

          this.handleErrorMessage(message.data);
          break;
        case 'SYMBOLS':
          this.emit('symbols', message.data);
          break;
        case 'SYMBOL_INFO':
          this.emit('symbolInfo', message.data);
          break;
        case 'EQUITIES':
          this.emit('equities', message.data);
          break;
        default:
          // eslint-disable-next-line no-console
          console.warn('Unknown message type:', message.type);
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to parse MT5 message:', error, 'Data:', data);
    }
  }

  /**
   * Processar mensagem de estado
   */
  private handleStateMessage(data: any): void {
    // Validar estado recebido
    const newState = data.state;
    
    // Ignorar mensagens de estado vazias ou inválidas
    if (!newState || typeof newState !== 'string') {
      // eslint-disable-next-line no-console
      console.warn('Mensagem STATE inválida ignorada:', data);
      return;
    }
    
    // Estados válidos
    const validStates: string[] = ['CONNECTED', 'CONNECTING', 'DISCONNECTED', 'ERROR'];
    if (!validStates.includes(newState)) {
      // eslint-disable-next-line no-console
      console.warn('Estado MT5 inválido ignorado:', newState);
      return;
    }
    
    // NÃO mudar para DISCONNECTED se o WebSocket ainda estiver conectado
    if (newState === 'DISCONNECTED' && this.ws?.readyState === WebSocket.OPEN) {
      // eslint-disable-next-line no-console
      console.log('Ignorando estado DISCONNECTED - WebSocket ainda está conectado (readyState:', this.ws.readyState, ')');
      return;
    }
    
    // eslint-disable-next-line no-console
    console.log('Estado MT5 atualizado:', newState);
    
    // Só atualizar e emitir se o estado realmente mudou
    if (this.connectionState.state !== newState) {
      this.connectionState = {
        ...this.connectionState,
        state: newState as 'CONNECTED' | 'CONNECTING' | 'DISCONNECTED' | 'ERROR',
        accountInfo: data.accountInfo,
      };
      this.emit('state', this.connectionState);
    }
  }

  /**
   * Converter tipo numérico de ordem para string
   */
  private orderTypeToString(type: number): string {
    const typeMap: { [key: number]: string } = {
      0: 'BUY',
      1: 'SELL',
      2: 'BUY_LIMIT',
      3: 'SELL_LIMIT',
      4: 'BUY_STOP',
      5: 'SELL_STOP',
      6: 'BUY_STOP_LIMIT',
      7: 'SELL_STOP_LIMIT',
    };
    return typeMap[type] || 'BUY';
  }

  /**
   * Converter estado numérico de ordem para string
   */
  private orderStateToString(state: number): string {
    const stateMap: { [key: number]: string } = {
      0: 'STARTED',
      1: 'PLACED',
      2: 'CANCELED',
      3: 'PARTIAL',
      4: 'FILLED',
      5: 'REJECTED',
      6: 'EXPIRED',
    };
    return stateMap[state] || 'PLACED';
  }

  /**
   * Converter tipo numérico de trade para string
   */
  private tradeTypeToString(type: number): 'BUY' | 'SELL' {
    return type === 0 ? 'BUY' : 'SELL';
  }

  /**
   * Processar mensagem de tick
   */
  private handleTickMessage(data: any): void {
    const tick: MT5Tick = {
      symbol: data.symbol,
      time: new Date(data.time),
      bid: data.bid,
      ask: data.ask,
      last: data.last,
      volume: data.volume,
      volumeReal: data.volumeReal,
      timeMsc: data.timeMsc,
      flags: data.flags,
      volumeDiff: data.volumeDiff,
      previousClose: data.previousClose,
      change: data.change,
      changePercent: data.changePercent,
    };
    this.emit('tick', tick);
  }

  /**
   * Processar mensagem de posição
   */
  private handlePositionMessage(data: any): void {
    const position: MT5Position = {
      ticket: data.ticket,
      time: new Date(data.time),
      timeMsc: data.timeMsc,
      timeUpdate: new Date(data.timeUpdate),
      timeUpdateMsc: data.timeUpdateMsc,
      type: data.type === 0 ? 'BUY' : 'SELL',
      magic: data.magic,
      identifier: data.identifier,
      reason: data.reason,
      volume: data.volume,
      priceOpen: data.priceOpen,
      sl: data.sl,
      tp: data.tp,
      priceCurrent: data.priceCurrent,
      swap: data.swap,
      profit: data.profit,
      symbol: data.symbol,
      comment: data.comment,
      externalId: data.externalId,
    };
    
    // Adicionar/atualizar no cache
    this.positionsCache.set(position.ticket, position);
    this.emit('position', position);
  }

  /**
   * Processar mensagem de ordem
   */
  private handleOrderMessage(data: any): void {
    const order: MT5Order = {
      ticket: data.ticket,
      timeSetup: new Date(data.timeSetup),
      timeSetupMsc: data.timeSetupMsc,
      timeDone: new Date(data.timeDone),
      timeDoneMsc: data.timeDoneMsc,
      type: data.type,  // MT5 envia como número (0=BUY, 1=SELL, etc.)
      state: data.state,  // MT5 envia como número (0=STARTED, 1=PLACED, etc.)
      expiration: new Date(data.expiration),
      volume: data.volume,
      priceCurrent: data.priceCurrent,
      priceStopLimit: data.priceStopLimit,
      priceSl: data.priceSl,
      priceTp: data.priceTp,
      comment: data.comment,
      position: data.position,
      positionBy: data.positionBy,
      volumeInitial: data.volumeInitial,
      volumeCurrent: data.volumeCurrent,
      priceOpen: data.priceOpen,
      magic: data.magic,
      reason: data.reason,
      symbol: data.symbol,
    };
    
    // Adicionar/atualizar no cache
    this.ordersCache.set(order.ticket, order);
    this.emit('order', order);
  }

  /**
   * Processar mensagem de trade
   */
  private handleTradeMessage(data: any): void {
    // Converter timestamp (Python envia em segundos, JavaScript precisa em milissegundos)
    let tradeTime: Date;
    if (typeof data.time === 'number') {
      // Se já está em milissegundos (valor muito grande), usar diretamente
      if (data.time > 10000000000) {
        tradeTime = new Date(data.time);
      } else {
        // Se está em segundos, multiplicar por 1000
        tradeTime = new Date(data.time * 1000);
      }
    } else if (data.time instanceof Date) {
      tradeTime = data.time;
    } else {
      tradeTime = new Date();
    }
    
    const trade: MT5Trade = {
      ticket: data.ticket,
      order: data.order,
      time: tradeTime,
      timeMsc: data.timeMsc,
      type: data.type,  // MT5 envia como número (0=BUY, 1=SELL)
      entry: data.entry,
      magic: data.magic,
      reason: data.reason,
      position: data.position,
      positionBy: data.positionBy,
      volume: data.volume,
      price: data.price,
      profit: data.profit,
      commission: data.commission,
      swap: data.swap,
      symbol: data.symbol,
      comment: data.comment,
    };
    
    // Adicionar/atualizar no cache
    this.tradesCache.set(trade.ticket, trade);
    this.emit('trade', trade);
  }

  /**
   * Processar mensagem de conta
   */
  private handleAccountMessage(data: any): void {
    const accountInfo: MT5AccountInfo = {
      login: data.login,
      tradeMode: data.tradeMode,
      leverage: data.leverage,
      limitOrders: data.limitOrders,
      marginSoCall: data.marginSoCall,
      marginSoMode: data.marginSoMode,
      currency: data.currency,
      balance: data.balance,
      credit: data.credit,
      profit: data.profit,
      equity: data.equity,
      margin: data.margin,
      marginFree: data.marginFree,
      marginLevel: data.marginLevel,
      marginInitial: data.marginInitial,
      marginMaintenance: data.marginMaintenance,
      marginRequired: data.marginRequired,
      assets: data.assets,
      liabilities: data.liabilities,
      commissionBlocked: data.commissionBlocked,
      name: data.name,
      server: data.server,
      currencyDigits: data.currencyDigits,
      fifoClose: data.fifoClose,
    };
    
    // Se é a primeira mensagem de conta (conexão inicial), salvar o saldo inicial do dia
    if (!this.initialDailyBalance && data.balance) {
      this.initialDailyBalance = data.balance;
      // eslint-disable-next-line no-console
      console.log('Saldo inicial do dia definido:', this.initialDailyBalance);
    }
    
    this.connectionState.accountInfo = accountInfo;
    this.emit('account', accountInfo);
  }

  /**
   * Processar mensagem de resultado de ordem
   */
  private handleOrderResultMessage(data: any): void {
    // eslint-disable-next-line no-console
    console.log('=== ORDER RESULT ===');
    // eslint-disable-next-line no-console
    console.log('Resultado:', data);
    
    // Verificar se a ordem foi bem-sucedida
    const isSuccess = data.retcode === 10009; // TRADE_RETCODE_DONE
    
    if (isSuccess) {
      // Emitir dados brutos diretamente para que o spreadOrderService possa acessar data.retcode, etc.
      this.emit('order', data);
      
      // Se é uma ordem de fechamento de posição (tem 'position' no resultado)
      // e o comentário indica fechamento, remover a posição do cache
      if (data.position && data.comment && data.comment.includes('Fechamento')) {
        // eslint-disable-next-line no-console
        console.log('Detectado fechamento de posição:', data.position);
        
        // Remover do cache de posições
        if (this.positionsCache.has(data.position)) {
          // eslint-disable-next-line no-console
          console.log('Removendo posição do cache:', data.position);
          this.positionsCache.delete(data.position);
          
          // Emitir evento específico de posição fechada
          this.emit('positionClosed', data.position);
        }
      }
    } else {
      this.emit('error', {
        type: 'order',
        message: data.comment || `Erro ao executar ordem (código: ${data.retcode})`,
        data,
      });
    }
  }

  /**
   * Processar mensagem de book de ofertas
   */
  private handleOrderBookMessage(data: any): void {
    this.emit('orderbook', data);
  }

  /**
   * Processar mensagem de erro
   */
  private handleErrorMessage(data: any): void {
    // Ignorar erros vazios ou sem conteúdo útil
    if (!data || 
        (typeof data === 'object' && Object.keys(data).length === 0) ||
        (typeof data === 'string' && data.trim() === '')) {
      // eslint-disable-next-line no-console
      console.warn('MT5 error vazio ignorado no handleErrorMessage - não emitindo evento de erro');
      return;
    }
    
    // Verificar se é um erro válido antes de logar
    let hasValidError = false;
    if (typeof data === 'string' && data.trim() !== '') {
      hasValidError = true;
    } else if (typeof data === 'object' && Object.keys(data).length > 0) {
      // Verificar se pelo menos uma propriedade tem valor
      hasValidError = Object.values(data).some(val => 
        val !== null && val !== undefined && val !== ''
      );
    }
    
    if (!hasValidError) {
      // eslint-disable-next-line no-console
      console.warn('MT5 error sem conteúdo válido - ignorando');
      return;
    }
    
    // eslint-disable-next-line no-console
    console.warn('MT5 error received:', data);
    
    // Tratar erro vazio ou sem mensagem
    let errorMessage = 'Unknown error';
    if (typeof data === 'string') {
      errorMessage = data;
    } else if (data && typeof data === 'object') {
      errorMessage = data.message || data.error || data.code || JSON.stringify(data);
    } else if (data) {
      errorMessage = String(data);
    }
    
    // NÃO mudar estado para ERROR se for erro específico que não afeta a conexão
    const shouldChangeState =
      data?.type !== 'order' &&
      !this.NON_FATAL_ERROR_CODES.has(data?.code) &&
      !this.NON_FATAL_ERROR_SUBSTRINGS.some((s) => errorMessage?.includes(s)) &&
      !(this.ws?.readyState === WebSocket.OPEN && data?.code);
    
    if (shouldChangeState) {
      this.connectionState.state = 'ERROR';
      this.connectionState.lastError = errorMessage;
      this.emit('state', this.connectionState);
    } else {
      // eslint-disable-next-line no-console
      console.log('Erro específico detectado - NÃO mudando estado para ERROR:', data?.code || errorMessage);
    }
    
    this.emit('error', {
      message: errorMessage,
      type: data?.type,
      code: data?.code,
      ...data,
    });
  }

  /**
   * Inscrever em eventos do MT5
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
   * Inscrever em ticks de símbolo
   */
  subscribeTicks(symbol: string): void {
    // Evitar inscrições duplicadas
    if (this.subscribedSymbols.has(symbol)) {
      return;
    }
    this.subscribedSymbols.add(symbol);
    this.send({
      type: 'SUBSCRIBE_TICKS',
      data: { symbol },
    });
  }

  /**
   * Desinscrever de ticks de símbolo
   */
  unsubscribeTicks(symbol: string): void {
    this.subscribedSymbols.delete(symbol);
    this.send({
      type: 'UNSUBSCRIBE_TICKS',
      data: { symbol },
    });
  }

  /** Obter lista completa de símbolos (comando já suportado pelo bridge). */
  getSymbols(): void {
    this.send({ type: 'GET_SYMBOLS', data: { includeDetails: true } });
  }

  /**
   * Obter informações de símbolo
   */
  getSymbolInfo(symbol: string): void {
    this.send({
      type: 'GET_SYMBOL_INFO',
      data: { symbol },
    });
  }

  /**
   * Obter posições
   */
  getPositions(symbol?: string): void {
    this.send({
      type: 'GET_POSITIONS',
      data: { symbol },
    });
  }

  /**
   * Obter informações da conta
   */
  getAccountInfo(): void {
    this.send({
      type: 'GET_ACCOUNT_INFO',
      data: {},
    });
  }

  /**
   * Obter ordens
   */
  getOrders(symbol?: string): void {
    this.send({
      type: 'GET_ORDERS',
      data: { symbol },
    });
  }

  /**
   * Obter lista de ações (equities) da B3
   */
  getEquities(): void {
    this.send({
      type: 'GET_EQUITIES',
      data: {},
    });
  }

  /**
   * Obter histórico de trades
   */
  getHistory(fromDate?: Date, toDate?: Date, symbol?: string): void {
    this.send({
      type: 'GET_HISTORY',
      data: {
        fromDate: fromDate?.toISOString(),
        toDate: toDate?.toISOString(),
        symbol,
      },
    });
  }

  /**
   * Enviar ordem
   */
  sendOrder(request: MT5OrderRequest): void {
    this.send({
      type: 'SEND_ORDER',
      data: request,
    });
  }

  /**
   * Modificar ordem
   */
  modifyOrder(ticket: number, request: Partial<MT5OrderRequest>): void {
    this.send({
      type: 'MODIFY_ORDER',
      data: { ticket, ...request },
    });
  }

  /**
   * Cancelar ordem
   */
  cancelOrder(ticket: number): void {
    this.send({
      type: 'CANCEL_ORDER',
      data: { ticket },
    });
  }

  /**
   * Fechar posição
   */
  closePosition(ticket: number, volume?: number): void {
    this.send({
      type: 'CLOSE_POSITION',
      data: { ticket, volume },
    });
  }

  /**
   * Fechar posição por posição oposta
   */
  closePositionBy(ticket: number, ticketBy: number): void {
    this.send({
      type: 'CLOSE_POSITION_BY',
      data: { ticket, ticketBy },
    });
  }

  /**
   * Obter book de ofertas (order book) - uma única vez
   */
  getOrderBook(symbol: string): void {
    this.send({
      type: 'GET_ORDER_BOOK',
      data: { symbol },
    });
  }

  /**
   * Inscrever em atualizações contínuas do book de ofertas
   * Igual a subscribeTicks() - o backend enviará atualizações automaticamente
   */
  subscribeOrderBook(symbol: string): void {
    // Evitar inscrições duplicadas
    if (this.subscribedOrderBooks.has(symbol)) {
      return;
    }
    this.subscribedOrderBooks.add(symbol);
    this.send({
      type: 'SUBSCRIBE_ORDER_BOOK',
      data: { symbol },
    });
  }

  /**
   * Desinscrever de atualizações contínuas do book de ofertas
   */
  unsubscribeOrderBook(symbol: string): void {
    this.subscribedOrderBooks.delete(symbol);
    this.send({
      type: 'UNSUBSCRIBE_ORDER_BOOK',
      data: { symbol },
    });
  }

  /**
   * Busca dados históricos de candles para um símbolo e timeframe
   */
  getChartData(symbol: string, timeframe: string, count: number = 200, range?: Readonly<{ from: string; to: string }>): Promise<MT5Candle[]> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.connectionState.state !== 'CONNECTED') {
        reject(new Error('MT5 não conectado'));
        return;
      }

      const requestId = ++this.chartRequestId;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        if (timeout) clearTimeout(timeout);
        this.off('chartData', onChartData);
        this.off('error', onError);
      };
      const fail = (error: Error) => { cleanup(); reject(error); };
      const onChartData = (data: { requestId?: number; symbol: string; timeframe: string; candles: MT5Candle[] }) => {
        if (data.requestId !== requestId || data.symbol !== symbol || data.timeframe !== timeframe) return;
        cleanup();
        resolve(data.candles);
      };
      const onError = (data: any) => {
        if (data?.requestId !== requestId || data?.symbol !== symbol || data?.timeframe !== timeframe) return;
        const code = typeof data.code === 'string' ? data.code : 'CHART_DATA_ERROR';
        fail(new Error(`${code}: ${data.message || 'Falha ao buscar chart data'}`));
      };

      this.on('chartData', onChartData);
      this.on('error', onError);
      timeout = setTimeout(() => fail(new Error('Timeout ao buscar chart data')), 60000);

      try {
        this.send({
          type: 'GET_CHART_DATA',
          data: { requestId, symbol, timeframe, count, ...(range ? { from: range.from, to: range.to } : {}) },
        });
      } catch (error) {
        fail(error instanceof Error ? error : new Error('Falha ao solicitar chart data'));
      }
    });
  }
}

// Export singleton instance for backward compatibility
class MT5ServiceSingleton {
  private static instance: MT5Service | null = null;

  static getInstance(): MT5Service {
    console.log('[MT5 SINGLETON] getInstance chamado - Instância existe?', !!MT5ServiceSingleton.instance);
    if (!MT5ServiceSingleton.instance) {
      console.log('[MT5 SINGLETON] Criando nova instância do MT5Service');
      MT5ServiceSingleton.instance = new MT5Service();
    } else {
      console.log('[MT5 SINGLETON] Retornando instância existente');
      console.log('[MT5 SINGLETON] Estado da instância existente:', MT5ServiceSingleton.instance.getConnectionState());
    }
    return MT5ServiceSingleton.instance;
  }
}

// Create and export singleton instance
const singletonInstance = MT5ServiceSingleton.getInstance();
export const mt5Service = singletonInstance;
export default MT5Service;
export { MT5ServiceSingleton };
