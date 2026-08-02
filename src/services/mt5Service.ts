import {
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
 * MetaTrader 5 Service — WR Trading Pro
 *
 * Conexão/status/conta/posições/ordens/símbolos/ticks/book: via MCP nativo
 * do MT5 (build 6060+), consultado server-side em /api/mt5/mcp/** — nunca
 * WebSocket, nunca senha no cliente. O login na conta MT5 acontece na
 * própria GUI do terminal, fora do WR.
 *
 * `this.ws` nunca é atribuído (não há mais handshake de WebSocket em
 * connect()) — o campo e `send()` abaixo sobrevivem só porque
 * `optionsService.ts` ainda os chama para símbolos de opções; nesse
 * caminho `send()` sempre no-opa (loga aviso, não conecta a nada).
 */

/**
 * Envio/alteração/fechamento de ordens nunca foi migrado ao MCP nativo e
 * não deve ser — eligibleForExecution continua false independentemente
 * de qualquer capability de conta (tradeAllowed etc.). Código e mensagem
 * são estáticos e sanitizados, sem depender de estado de conexão/conta.
 */
export class Mt5TradingUnavailableError extends Error {
  static readonly CODE = 'MT5_TRADING_UNAVAILABLE' as const;
  static readonly MESSAGE =
    'Envio, alteração e fechamento de ordens não estão disponíveis nesta versão. Nenhuma ordem foi enviada ao MT5.';
  readonly code = Mt5TradingUnavailableError.CODE;

  constructor() {
    super(Mt5TradingUnavailableError.MESSAGE);
    this.name = 'Mt5TradingUnavailableError';
  }
}
class MT5Service {
  private ws: WebSocket | null = null;
  private connectionState: MT5ConnectionStatus = {
    state: 'DISCONNECTED',
    isConnected: false,
  };
  private listeners: Map<string, Set<(data: any) => void>> = new Map();
  // Serializa tentativas concorrentes de connect().
  private connectPromise: Promise<boolean> | null = null;
  // Invalida fetch de status em andamento quando disconnect() é chamado no meio.
  private connectionGeneration = 0;
  private statusPollTimer: ReturnType<typeof setInterval> | null = null;
  private chartRequestId = 0;

  // Status do MCP nativo é por polling HTTP (sem push) — intervalo de
  // atualização do card de conexão; independente do polling de ticks.
  private readonly STATUS_POLL_INTERVAL_MS = 5000;
  private readonly STATUS_FETCH_TIMEOUT_MS = 10000;
  // Ticks também são por polling HTTP (MCP nativo não tem push) — um
  // intervalo por símbolo inscrito, espelhando DEFAULT_POLL_INTERVAL_MS
  // documentado em mt5-mcp-config.ts.
  private readonly TICK_POLL_INTERVAL_MS = 1500;
  private tickPollTimers: Map<string, ReturnType<typeof setInterval>> = new Map();
  // Book de ofertas também é por polling HTTP (MCP nativo não tem push) —
  // mesmo intervalo de subscribeTicks, já que ambos são dados de mercado
  // ao vivo.
  private readonly ORDER_BOOK_POLL_INTERVAL_MS = 1500;
  private orderBookPollTimers: Map<string, ReturnType<typeof setInterval>> = new Map();
  // Evita disparar um novo fetch do mesmo símbolo enquanto o anterior ainda está em andamento.
  private orderBookFetchInFlight: Set<string> = new Set();

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

  constructor() {}

  /**
   * Obter estado atual da conexão
   */
  getConnectionState(): MT5ConnectionStatus {
    return { ...this.connectionState };
  }

  /**
   * Consulta o status do MT5 MCP nativo (server-side, sem senha) e atualiza
   * o estado da conexão. Em caso de sucesso, inicia o polling periódico que
   * mantém o card de conexão atualizado (o MCP nativo não tem push).
   */
  async connect(): Promise<boolean> {
    if (this.connectPromise) {
      return this.connectPromise;
    }
    const attempt = this.connectInternal();
    this.connectPromise = attempt;
    try {
      return await attempt;
    } finally {
      if (this.connectPromise === attempt) {
        this.connectPromise = null;
      }
    }
  }

  private async connectInternal(): Promise<boolean> {
    const generation = this.connectionGeneration;
    this.connectionState = { ...this.connectionState, state: 'CONNECTING', isConnected: false, lastError: undefined };
    this.emit('state', this.connectionState);

    const ok = await this.refreshMcpStatus(generation);
    if (generation !== this.connectionGeneration) {
      return false;
    }

    if (ok && !this.statusPollTimer) {
      this.statusPollTimer = setInterval(() => {
        void this.refreshMcpStatus(this.connectionGeneration);
      }, this.STATUS_POLL_INTERVAL_MS);
    }
    return ok;
  }

  /** Busca /api/mt5/mcp/status e aplica o resultado ao estado local. Nunca lança — só atualiza connectionState. */
  private async refreshMcpStatus(generation: number): Promise<boolean> {
    let response: Response;
    try {
      response = await fetch('/api/mt5/mcp/status', {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.timeout(this.STATUS_FETCH_TIMEOUT_MS),
      });
    } catch {
      if (generation !== this.connectionGeneration) return false;
      this.setErrorState('Falha de rede ao consultar o status do MT5 MCP nativo');
      return false;
    }

    if (generation !== this.connectionGeneration) return false;

    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.success) {
      const message =
        (body?.error?.message as string | undefined) ||
        `Falha ao consultar o status do MT5 MCP nativo (HTTP ${response.status})`;
      this.setErrorState(message);
      return false;
    }

    const data = body.data as {
      accountInfo?: MT5AccountInfo | null;
      accountError?: { message?: string };
    };
    this.connectionState = {
      state: 'CONNECTED',
      isConnected: true,
      accountInfo: data.accountInfo ?? undefined,
      lastError: data.accountError?.message,
    };
    this.emit('state', this.connectionState);
    return true;
  }

  private setErrorState(message: string): void {
    this.connectionState = { state: 'ERROR', isConnected: false, lastError: message };
    this.emit('state', this.connectionState);
  }

  /**
   * Checagem SOMENTE LEITURA de elegibilidade de trading (AutoTrading/conta),
   * via /api/mt5/mcp/trading-eligibility. Nunca referencia nem abre um
   * caminho de envio de ordem — usada só para a UI decidir se mostra algo
   * como habilitado/desabilitado em fases futuras.
   */
  async checkTradingEligibility(): Promise<{ tradeAllowed: boolean; reason?: string }> {
    try {
      const response = await fetch('/api/mt5/mcp/trading-eligibility', {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.timeout(this.STATUS_FETCH_TIMEOUT_MS),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.success) {
        return {
          tradeAllowed: false,
          reason: body?.error?.message || 'Não foi possível verificar elegibilidade de trading',
        };
      }
      return body.data as { tradeAllowed: boolean; reason?: string };
    } catch {
      return { tradeAllowed: false, reason: 'Falha de rede ao verificar elegibilidade de trading' };
    }
  }

  /**
   * Desconectar (encerra o polling de status local — não afeta a sessão do
   * MCP nativo mantida server-side nem o terminal MT5).
   */
  disconnect(): void {
    // Invalida qualquer refreshMcpStatus() em andamento.
    this.connectionGeneration++;
    this.connectPromise = null;

    if (this.statusPollTimer) {
      clearInterval(this.statusPollTimer);
      this.statusPollTimer = null;
    }

    this.connectionState = { state: 'DISCONNECTED', isConnected: false, lastError: undefined };
    this.emit('state', this.connectionState);

    // Parar polling de ticks — senão os timers seguem chamando o MCP nativo
    // mesmo com o card mostrando "desconectado".
    for (const timer of this.tickPollTimers.values()) {
      clearInterval(timer);
    }
    this.tickPollTimers.clear();

    // Parar polling de book de ofertas pelo mesmo motivo dos ticks.
    for (const timer of this.orderBookPollTimers.values()) {
      clearInterval(timer);
    }
    this.orderBookPollTimers.clear();
    this.orderBookFetchInFlight.clear();
    this.subscribedOrderBooks.clear();

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
   * Enviar mensagem para o bridge Python legado — `this.ws` nunca é
   * atribuído, então isto sempre no-opa (só loga aviso). Mantido porque
   * `optionsService.ts` ainda chama este método; nada mais no app o faz.
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
   * Inscrever em ticks de símbolo — via MCP nativo server-side
   * (GET /api/mt5/mcp/tick?symbol=...), por polling (sem push). Somente
   * leitura. Preserva o contrato de evento existente ('tick') para não
   * exigir mudanças nos componentes consumidores.
   */
  subscribeTicks(symbol: string): void {
    // Evitar inscrições duplicadas
    if (this.subscribedSymbols.has(symbol)) {
      return;
    }
    this.subscribedSymbols.add(symbol);
    void this.fetchTickFromMcp(symbol);
    const timer = setInterval(() => void this.fetchTickFromMcp(symbol), this.TICK_POLL_INTERVAL_MS);
    this.tickPollTimers.set(symbol, timer);
  }

  /**
   * Desinscrever de ticks de símbolo
   */
  unsubscribeTicks(symbol: string): void {
    this.subscribedSymbols.delete(symbol);
    const timer = this.tickPollTimers.get(symbol);
    if (timer) {
      clearInterval(timer);
      this.tickPollTimers.delete(symbol);
    }
  }

  private async fetchTickFromMcp(symbol: string): Promise<void> {
    // Símbolo pode ter sido desinscrito enquanto o fetch anterior aguardava a rede.
    if (!this.subscribedSymbols.has(symbol)) return;

    let response: Response;
    try {
      response = await fetch(`/api/mt5/mcp/tick?symbol=${encodeURIComponent(symbol)}`, {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.timeout(this.STATUS_FETCH_TIMEOUT_MS),
      });
    } catch {
      this.emit('error', { type: 'tick', symbol, message: 'Falha de rede ao consultar tick' });
      return;
    }

    if (!this.subscribedSymbols.has(symbol)) return;

    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.success) {
      const message =
        (body?.error?.message as string | undefined) || `Falha ao consultar tick (HTTP ${response.status})`;
      this.emit('error', { type: 'tick', symbol, message, code: body?.error?.code });
      return;
    }

    if (!body.data?.tick) return;
    const tick = this.normalizeMcpTick(symbol, body.data.tick);
    this.emit('tick', tick);
  }

  /** Tolerante a snake_case (atributos brutos do MetaTrader5) e camelCase — schema do MCP nativo não é documentado. */
  private normalizeMcpTick(symbol: string, raw: any): MT5Tick {
    return {
      symbol: raw.symbol ?? symbol,
      time: this.parseMcpTimestamp(raw.time),
      bid: raw.bid ?? 0,
      ask: raw.ask ?? 0,
      last: raw.last ?? 0,
      volume: raw.volume ?? 0,
      volumeReal: raw.volume_real ?? raw.volumeReal ?? 0,
      timeMsc: raw.time_msc ?? raw.timeMsc ?? 0,
      flags: raw.flags ?? 0,
      volumeDiff: raw.volume_diff ?? raw.volumeDiff ?? 0,
      previousClose: raw.previous_close ?? raw.previousClose,
      change: raw.change,
      changePercent: raw.change_percent ?? raw.changePercent,
      digits: raw.digits,
    };
  }

  /**
   * Obter lista completa de símbolos — via MCP nativo server-side
   * (GET /api/mt5/mcp/symbols). Somente leitura, requisição única (sem
   * polling — símbolos não mudam como tick). Preserva o contrato de evento
   * existente ('symbols', lista completa emitida uma vez) para não exigir
   * mudanças nos consumidores (ex.: Mt5InstrumentCatalog).
   */
  getSymbols(): void {
    void this.fetchSymbolsFromMcp();
  }

  private async fetchSymbolsFromMcp(): Promise<void> {
    let response: Response;
    try {
      response = await fetch('/api/mt5/mcp/symbols', {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.timeout(this.STATUS_FETCH_TIMEOUT_MS),
      });
    } catch {
      this.emit('error', { type: 'symbols', message: 'Falha de rede ao consultar símbolos' });
      return;
    }

    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.success) {
      const message =
        (body?.error?.message as string | undefined) || `Falha ao consultar símbolos (HTTP ${response.status})`;
      this.emit('error', { type: 'symbols', message, code: body?.error?.code });
      return;
    }

    const rawSymbols = Array.isArray(body.data?.symbols) ? body.data.symbols : [];
    this.emit('symbols', rawSymbols);
  }

  /**
   * Obter informações de símbolo
   */
  /**
   * Obter informações de um símbolo — via MCP nativo server-side
   * (GET /api/mt5/mcp/symbol-info). Somente leitura, requisição única.
   * Preserva o contrato de evento existente ('symbolInfo') para não exigir
   * mudanças no consumidor (Mt5InstrumentCatalog.getInstrument).
   */
  getSymbolInfo(symbol: string): void {
    void this.fetchSymbolInfoFromMcp(symbol);
  }

  private async fetchSymbolInfoFromMcp(symbol: string): Promise<void> {
    let response: Response;
    try {
      response = await fetch(`/api/mt5/mcp/symbol-info?symbol=${encodeURIComponent(symbol)}`, {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.timeout(this.STATUS_FETCH_TIMEOUT_MS),
      });
    } catch {
      this.emit('error', { type: 'symbolInfo', symbol, message: 'Falha de rede ao consultar informações do símbolo' });
      return;
    }

    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.success) {
      const message =
        (body?.error?.message as string | undefined) ||
        `Falha ao consultar informações do símbolo (HTTP ${response.status})`;
      this.emit('error', { type: 'symbolInfo', symbol, message, code: body?.error?.code });
      return;
    }

    if (!body.data?.symbolInfo) return;
    const info = this.normalizeMcpSymbolInfo(symbol, body.data.symbolInfo);
    this.emit('symbolInfo', info);
  }

  /** Garante o campo symbol (fallback pro symbol solicitado) — Mt5InstrumentCatalog.mapInstrument já faz o mapeamento de campos a partir daqui, então não precisa de normalização pesada como positions/orders. */
  private normalizeMcpSymbolInfo(symbol: string, raw: any): Record<string, unknown> {
    return { ...raw, symbol: raw?.symbol ?? raw?.name ?? symbol };
  }

  /**
   * Obter posições — via MCP nativo server-side (GET /api/mt5/mcp/positions).
   * Somente leitura: não envia, modifica nem fecha posição/ordem. Preserva o
   * contrato de eventos existente ('position'/'positionClosed') para não
   * exigir mudanças nos componentes consumidores.
   */
  getPositions(symbol?: string): void {
    void this.fetchPositionsFromMcp(symbol);
  }

  private async fetchPositionsFromMcp(symbol?: string): Promise<void> {
    let response: Response;
    try {
      const query = symbol ? `?symbol=${encodeURIComponent(symbol)}` : '';
      response = await fetch(`/api/mt5/mcp/positions${query}`, {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.timeout(this.STATUS_FETCH_TIMEOUT_MS),
      });
    } catch {
      this.emit('error', { type: 'positions', message: 'Falha de rede ao consultar posições' });
      return;
    }

    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.success) {
      const message =
        (body?.error?.message as string | undefined) || `Falha ao consultar posições (HTTP ${response.status})`;
      this.emit('error', { type: 'positions', message, code: body?.error?.code });
      return;
    }

    const rawPositions = Array.isArray(body.data?.positions) ? body.data.positions : [];
    const seenTickets = new Set<number>();
    for (const raw of rawPositions) {
      const position = this.normalizeMcpPosition(raw);
      seenTickets.add(position.ticket);
      this.positionsCache.set(position.ticket, position);
      this.emit('position', position);
    }

    // Posições que não vieram mais nesta consulta foram fechadas/alteradas fora do WR.
    for (const ticket of Array.from(this.positionsCache.keys())) {
      if (!seenTickets.has(ticket)) {
        this.positionsCache.delete(ticket);
        this.emit('positionClosed', ticket);
      }
    }
  }

  /** Tolerante a snake_case (atributos brutos do MetaTrader5) e camelCase — schema do MCP nativo não é documentado. */
  private normalizeMcpPosition(raw: any): MT5Position {
    return {
      ticket: raw.ticket,
      time: this.parseMcpTimestamp(raw.time),
      timeMsc: raw.time_msc ?? raw.timeMsc ?? 0,
      timeUpdate: this.parseMcpTimestamp(raw.time_update ?? raw.timeUpdate),
      timeUpdateMsc: raw.time_update_msc ?? raw.timeUpdateMsc ?? 0,
      type: raw.type === 0 || raw.type === 'BUY' ? 'BUY' : 'SELL',
      magic: raw.magic ?? 0,
      identifier: raw.identifier ?? 0,
      reason: raw.reason ?? 0,
      volume: raw.volume ?? 0,
      priceOpen: raw.price_open ?? raw.priceOpen ?? 0,
      sl: raw.sl ?? 0,
      tp: raw.tp ?? 0,
      priceCurrent: raw.price_current ?? raw.priceCurrent ?? 0,
      swap: raw.swap ?? 0,
      profit: raw.profit ?? 0,
      symbol: raw.symbol,
      comment: raw.comment,
      externalId: raw.external_id ?? raw.externalId,
    };
  }

  /** Aceita epoch em segundos/ms, string ou Date — schema do MCP nativo não é documentado. */
  private parseMcpTimestamp(value: unknown): Date {
    if (value instanceof Date) return value;
    if (typeof value === 'number') return new Date(value > 10000000000 ? value : value * 1000);
    if (typeof value === 'string') {
      const numeric = Number(value);
      if (!Number.isNaN(numeric) && value.trim() !== '') {
        return new Date(numeric > 10000000000 ? numeric : numeric * 1000);
      }
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
    }
    return new Date(0);
  }

  /**
   * Obter ordens
   */
  /**
   * Obter ordens — via MCP nativo server-side (GET /api/mt5/mcp/orders).
   * Somente leitura, requisição única. Preserva o contrato de evento/cache
   * existente ('order'/ordersCache) para não exigir mudanças no consumidor
   * (MT5Orders.tsx).
   */
  getOrders(symbol?: string): void {
    void this.fetchOrdersFromMcp(symbol);
  }

  private async fetchOrdersFromMcp(symbol?: string): Promise<void> {
    let response: Response;
    try {
      const query = symbol ? `?symbol=${encodeURIComponent(symbol)}` : '';
      response = await fetch(`/api/mt5/mcp/orders${query}`, {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.timeout(this.STATUS_FETCH_TIMEOUT_MS),
      });
    } catch {
      this.emit('error', { type: 'orders', message: 'Falha de rede ao consultar ordens' });
      return;
    }

    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.success) {
      const message =
        (body?.error?.message as string | undefined) || `Falha ao consultar ordens (HTTP ${response.status})`;
      this.emit('error', { type: 'orders', message, code: body?.error?.code });
      return;
    }

    const rawOrders = Array.isArray(body.data?.orders) ? body.data.orders : [];
    for (const raw of rawOrders) {
      const order = this.normalizeMcpOrder(raw);
      this.ordersCache.set(order.ticket, order);
      this.emit('order', order);
    }
  }

  /** Tolerante a snake_case (atributos brutos do MetaTrader5) e camelCase — schema do MCP nativo não é documentado. */
  private normalizeMcpOrder(raw: any): MT5Order {
    return {
      ticket: raw.ticket,
      timeSetup: this.parseMcpTimestamp(raw.time_setup ?? raw.timeSetup),
      timeSetupMsc: raw.time_setup_msc ?? raw.timeSetupMsc ?? 0,
      timeDone: this.parseMcpTimestamp(raw.time_done ?? raw.timeDone),
      timeDoneMsc: raw.time_done_msc ?? raw.timeDoneMsc ?? 0,
      type: Number(raw.type),
      state: Number(raw.state),
      expiration: this.parseMcpTimestamp(raw.time_expiration ?? raw.expiration),
      volume: raw.volume ?? raw.volume_initial ?? raw.volumeInitial ?? 0,
      priceCurrent: raw.price_current ?? raw.priceCurrent ?? 0,
      priceStopLimit: raw.price_stoplimit ?? raw.priceStopLimit ?? 0,
      priceSl: raw.sl ?? raw.priceSl ?? 0,
      priceTp: raw.tp ?? raw.priceTp ?? 0,
      comment: raw.comment,
      position: raw.position_id ?? raw.position ?? 0,
      positionBy: raw.position_by_id ?? raw.positionBy ?? 0,
      volumeInitial: raw.volume_initial ?? raw.volumeInitial ?? 0,
      volumeCurrent: raw.volume_current ?? raw.volumeCurrent ?? 0,
      priceOpen: raw.price_open ?? raw.priceOpen ?? 0,
      magic: raw.magic ?? 0,
      reason: raw.reason ?? 0,
      symbol: raw.symbol,
    };
  }

  /**
   * Obter lista de ações (equities) da B3 — reusa o catálogo de símbolos já
   * migrado (GET /api/mt5/mcp/symbols) e filtra com filterB3EquityNames
   * (mesmo critério do bridge Python legado, definida logo abaixo da
   * classe). Sem capability/rota nova — se o MCP nativo não incluir o
   * campo `path`, degrada para lista vazia (nunca inclui símbolo errado,
   * só deixa de incluir).
   */
  getEquities(): void {
    void this.fetchEquitiesFromSymbols();
  }

  private async fetchEquitiesFromSymbols(): Promise<void> {
    let response: Response;
    try {
      response = await fetch('/api/mt5/mcp/symbols', {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.timeout(this.STATUS_FETCH_TIMEOUT_MS),
      });
    } catch {
      this.emit('error', { type: 'equities', message: 'Falha de rede ao consultar ações da B3' });
      return;
    }

    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.success) {
      const message =
        (body?.error?.message as string | undefined) || `Falha ao consultar ações da B3 (HTTP ${response.status})`;
      this.emit('error', { type: 'equities', message, code: body?.error?.code });
      return;
    }

    const rawSymbols = Array.isArray(body.data?.symbols) ? body.data.symbols : [];
    const equities = filterB3EquityNames(rawSymbols);
    this.emit('equities', { equities });
  }

  /**
   * Obter histórico de trades
   */
  /**
   * Obter histórico de deals — via MCP nativo server-side
   * (GET /api/mt5/mcp/history). Somente leitura, requisição única. Preserva
   * o contrato de evento/cache existente ('trade'/tradesCache) para não
   * exigir mudanças no consumidor (MT5Orders.tsx).
   */
  getHistory(fromDate?: Date, toDate?: Date, symbol?: string): void {
    void this.fetchHistoryFromMcp(fromDate, toDate, symbol);
  }

  private async fetchHistoryFromMcp(fromDate?: Date, toDate?: Date, symbol?: string): Promise<void> {
    const params = new URLSearchParams();
    if (fromDate) params.set('from', fromDate.toISOString());
    if (toDate) params.set('to', toDate.toISOString());
    if (symbol) params.set('symbol', symbol);
    const query = params.toString();

    let response: Response;
    try {
      response = await fetch(`/api/mt5/mcp/history${query ? `?${query}` : ''}`, {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.timeout(this.STATUS_FETCH_TIMEOUT_MS),
      });
    } catch {
      this.emit('error', { type: 'history', message: 'Falha de rede ao consultar histórico' });
      return;
    }

    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.success) {
      const message =
        (body?.error?.message as string | undefined) || `Falha ao consultar histórico (HTTP ${response.status})`;
      this.emit('error', { type: 'history', message, code: body?.error?.code });
      return;
    }

    const rawDeals = Array.isArray(body.data?.deals) ? body.data.deals : [];
    for (const raw of rawDeals) {
      const trade = this.normalizeMcpTrade(raw);
      this.tradesCache.set(trade.ticket, trade);
      this.emit('trade', trade);
    }
  }

  /** Tolerante a snake_case (atributos brutos do MetaTrader5) e camelCase — schema do MCP nativo não é documentado. */
  private normalizeMcpTrade(raw: any): MT5Trade {
    return {
      ticket: raw.ticket,
      order: raw.order,
      time: this.parseMcpTimestamp(raw.time),
      timeMsc: raw.time_msc ?? raw.timeMsc ?? 0,
      type: Number(raw.type),
      entry: Number(raw.entry),
      magic: raw.magic ?? 0,
      reason: raw.reason ?? 0,
      position: raw.position_id ?? raw.position ?? 0,
      positionBy: raw.position_by_id ?? raw.positionBy ?? 0,
      volume: raw.volume ?? 0,
      price: raw.price ?? 0,
      profit: raw.profit ?? 0,
      commission: raw.commission ?? 0,
      swap: raw.swap ?? 0,
      symbol: raw.symbol,
      comment: raw.comment,
    };
  }

  /**
   * Erro de execução de ordem — carrega o código tipado do servidor (ver
   * src/types/mt5-mcp.ts) para a UI mostrar mensagem acionável (ex.
   * MT5_MCP_TRADING_NOT_ALLOWED quando o AutoTrading do terminal está
   * desligado), nunca um erro genérico.
   */
  private async postMcpOrder(path: string, body: Record<string, unknown>): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`/api/mt5/mcp/order/${path}`, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.STATUS_FETCH_TIMEOUT_MS),
      });
    } catch {
      throw new Error('Falha de rede ao enviar ordem ao MT5.');
    }
    const responseBody = await response.json().catch(() => null);
    if (!response.ok || !responseBody?.success) {
      const message =
        (responseBody?.error?.message as string | undefined) || `Falha ao enviar ordem (HTTP ${response.status})`;
      this.emit('error', { type: 'order', message, code: responseBody?.error?.code });
      throw new Error(message);
    }
    return responseBody.data?.result;
  }

  /** Tolerante a snake_case — schema de retorno das tools de trade não é documentado publicamente. */
  private normalizeMcpOrderResult(raw: any): MT5OrderResult {
    const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    return {
      retcode: Number(obj.retcode ?? 0),
      deal: Number(obj.deal ?? 0),
      order: Number(obj.order ?? obj.order_ticket ?? obj.position_ticket ?? 0),
      volume: Number(obj.volume ?? 0),
      price: Number(obj.price ?? 0),
      bid: Number(obj.bid ?? 0),
      ask: Number(obj.ask ?? 0),
      comment: String(obj.comment ?? ''),
      request_id: Number(obj.request_id ?? 0),
      retcodeExternal: Number(obj.retcode_external ?? obj.retcodeExternal ?? 0),
    };
  }

  /**
   * Enviar ordem — via MCP nativo server-side (POST /api/mt5/mcp/order/*).
   * Habilitado em 2026-08-02; antes era fail-closed por decisão de
   * governança. Traduz o contrato antigo (action/type) para o schema real
   * das tools de trade do MT5 nativo.
   */
  async sendOrder(request: MT5OrderRequest): Promise<MT5OrderResult> {
    if (request.action === 'TRADE_ACTION_DEAL') {
      const side = request.type === 'ORDER_TYPE_SELL' ? 'sell' : 'buy';
      const result = await this.postMcpOrder('market', {
        symbol: request.symbol,
        side,
        volume: request.volume,
        sl: request.sl,
        tp: request.tp,
        comment: request.comment,
      });
      return this.normalizeMcpOrderResult(result);
    }
    if (request.action === 'TRADE_ACTION_PENDING') {
      const typeMap: Partial<Record<MT5OrderRequest['type'], string>> = {
        ORDER_TYPE_BUY_LIMIT: 'buy_limit',
        ORDER_TYPE_SELL_LIMIT: 'sell_limit',
        ORDER_TYPE_BUY_STOP: 'buy_stop',
        ORDER_TYPE_SELL_STOP: 'sell_stop',
      };
      const type = typeMap[request.type];
      if (!type) throw new Error(`Tipo de ordem pendente não suportado: ${request.type}`);
      const result = await this.postMcpOrder('pending', {
        symbol: request.symbol,
        type,
        volume: request.volume,
        price: request.price,
        sl: request.sl,
        tp: request.tp,
        comment: request.comment,
      });
      return this.normalizeMcpOrderResult(result);
    }
    if (request.action === 'TRADE_ACTION_SLTP') {
      const result = await this.postMcpOrder('modify-sltp', {
        symbol: request.symbol,
        positionTicket: request.position,
        sl: request.sl,
        tp: request.tp,
      });
      return this.normalizeMcpOrderResult(result);
    }
    if (request.action === 'TRADE_ACTION_REMOVE') {
      const result = await this.postMcpOrder('delete', { symbol: request.symbol, orderTicket: request.order });
      return this.normalizeMcpOrderResult(result);
    }
    if (request.action === 'TRADE_ACTION_CLOSE_BY') {
      const result = await this.postMcpOrder('close-by', {
        symbol: request.symbol,
        positionTicket: request.position,
        positionTicketBy: request.positionBy,
      });
      return this.normalizeMcpOrderResult(result);
    }
    throw new Error(`Ação de ordem não suportada: ${request.action}`);
  }

  /** Modificar SL/TP de uma ordem pendente (não de posição — ver closePosition para isso). */
  async modifyOrder(ticket: number, request: Partial<MT5OrderRequest> & { symbol: string }): Promise<MT5OrderResult> {
    const result = await this.postMcpOrder('modify-sltp', {
      symbol: request.symbol,
      orderTicket: ticket,
      sl: request.sl,
      tp: request.tp,
    });
    return this.normalizeMcpOrderResult(result);
  }

  /** Cancelar ordem pendente. */
  async cancelOrder(ticket: number, symbol: string): Promise<MT5OrderResult> {
    const result = await this.postMcpOrder('delete', { symbol, orderTicket: ticket });
    return this.normalizeMcpOrderResult(result);
  }

  /** Fechar posição — fecha o volume total (o MCP nativo não aceita fechamento parcial por volume). */
  async closePosition(ticket: number, symbol: string): Promise<MT5OrderResult> {
    const result = await this.postMcpOrder('close', { symbol, positionTicket: ticket });
    return this.normalizeMcpOrderResult(result);
  }

  /** Fechar posição por posição oposta (mesmo símbolo, lados opostos). */
  async closePositionBy(ticket: number, ticketBy: number, symbol: string): Promise<MT5OrderResult> {
    const result = await this.postMcpOrder('close-by', {
      symbol,
      positionTicket: ticket,
      positionTicketBy: ticketBy,
    });
    return this.normalizeMcpOrderResult(result);
  }

  /**
   * Obter book de ofertas (uma única vez) — via MCP nativo server-side
   * (GET /api/mt5/mcp/order-book). Somente leitura, requisição única.
   * Preserva o contrato de evento existente ('orderbook'); subscribeOrderBook/
   * unsubscribeOrderBook também migrados, via polling (ver abaixo).
   */
  getOrderBook(symbol: string): void {
    void this.fetchOrderBookFromMcp(symbol);
  }

  private async fetchOrderBookFromMcp(symbol: string): Promise<string | undefined> {
    let response: Response;
    try {
      response = await fetch(`/api/mt5/mcp/order-book?symbol=${encodeURIComponent(symbol)}`, {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.timeout(this.STATUS_FETCH_TIMEOUT_MS),
      });
    } catch {
      this.emit('error', { type: 'orderBook', symbol, message: 'Falha de rede ao consultar book de ofertas' });
      return undefined;
    }

    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.success) {
      const message =
        (body?.error?.message as string | undefined) || `Falha ao consultar book de ofertas (HTTP ${response.status})`;
      const code = body?.error?.code as string | undefined;
      this.emit('error', { type: 'orderBook', symbol, message, code });
      return code;
    }

    if (!body.data?.book) return undefined;
    const book = this.normalizeMcpOrderBook(symbol, body.data.book);
    this.emit('orderbook', book);
    return undefined;
  }

  /**
   * Tolerante a snake_case — se o MCP nativo já devolver {bids,asks},
   * repassa direto; se devolver lista plana com campo `type` (convenção
   * MetaTrader5 real, confirmada em python/mt5_bridge.py:993-1005:
   * BOOK_TYPE_SELL=1/BOOK_TYPE_SELL_MARKET=3 são ask, BOOK_TYPE_BUY=2/
   * BOOK_TYPE_BUY_MARKET=4 são bid), separa aqui. Tipo desconhecido é
   * ignorado — não entra em bids nem em asks, nunca classificado por
   * default.
   */
  private normalizeMcpOrderBook(symbol: string, raw: any): Record<string, unknown> {
    if (raw && (Array.isArray(raw.bids) || Array.isArray(raw.asks))) {
      return { symbol: raw.symbol ?? symbol, bids: raw.bids ?? [], asks: raw.asks ?? [], digits: raw.digits };
    }
    const entries: any[] = Array.isArray(raw) ? raw : [];
    const bids: Array<{ price: number; volume: number }> = [];
    const asks: Array<{ price: number; volume: number }> = [];
    const BID_TYPES = new Set<unknown>([2, 4, 'BUY', 'BOOK_TYPE_BUY', 'BUY_MARKET', 'BOOK_TYPE_BUY_MARKET']);
    const ASK_TYPES = new Set<unknown>([1, 3, 'SELL', 'BOOK_TYPE_SELL', 'SELL_MARKET', 'BOOK_TYPE_SELL_MARKET']);
    for (const entry of entries) {
      const type = entry?.type;
      const price = Number(entry?.price ?? 0);
      const volume = Number(entry?.volume ?? entry?.volume_dbl ?? 0);
      if (BID_TYPES.has(type)) {
        bids.push({ price, volume });
      } else if (ASK_TYPES.has(type)) {
        asks.push({ price, volume });
      }
      // tipo desconhecido: ignorado, não entra em bids nem asks
    }
    return { symbol, bids, asks };
  }

  /**
   * Inscrever em atualizações contínuas do book de ofertas — via MCP nativo
   * server-side (GET /api/mt5/mcp/order-book), por polling (sem push).
   * Somente leitura. Reusa fetchOrderBookFromMcp/normalizeMcpOrderBook (já
   * migrados) sem alterá-los; preserva o contrato de evento existente
   * ('orderbook') para não exigir mudanças em OrderBook.tsx.
   */
  subscribeOrderBook(symbol: string): void {
    // Evitar inscrições duplicadas
    if (this.subscribedOrderBooks.has(symbol)) {
      return;
    }
    this.subscribedOrderBooks.add(symbol);
    void this.pollOrderBookOnce(symbol);
    const timer = setInterval(() => void this.pollOrderBookOnce(symbol), this.ORDER_BOOK_POLL_INTERVAL_MS);
    this.orderBookPollTimers.set(symbol, timer);
  }

  /**
   * Desinscrever de atualizações contínuas do book de ofertas
   */
  unsubscribeOrderBook(symbol: string): void {
    this.subscribedOrderBooks.delete(symbol);
    const timer = this.orderBookPollTimers.get(symbol);
    if (timer) {
      clearInterval(timer);
      this.orderBookPollTimers.delete(symbol);
    }
  }

  /** Guarda inscrição + evita overlap de requests; chama fetchOrderBookFromMcp sem alterá-lo. */
  private async pollOrderBookOnce(symbol: string): Promise<void> {
    if (!this.subscribedOrderBooks.has(symbol)) return; // desinscrito antes desta rodada
    if (this.orderBookFetchInFlight.has(symbol)) return; // fetch anterior ainda em andamento
    this.orderBookFetchInFlight.add(symbol);
    try {
      const errorCode = await this.fetchOrderBookFromMcp(symbol);
      if (errorCode === 'MT5_MCP_TOOL_MISSING' || errorCode === 'MT5_MCP_NOT_CONFIGURED') {
        this.unsubscribeOrderBook(symbol); // erro permanente — não adianta continuar tentando
      }
    } finally {
      this.orderBookFetchInFlight.delete(symbol);
    }
  }

  /**
   * Busca dados históricos de candles para um símbolo e timeframe — via MCP
   * nativo server-side (GET /api/mt5/mcp/rates). Somente leitura. Mesma
   * assinatura pública/contrato de retorno de antes, para não exigir
   * mudanças nos consumidores (CandlestickChart, DashboardTab,
   * historicalDataService, optionsService).
   */
  async getChartData(symbol: string, timeframe: string, count: number = 200, range?: Readonly<{ from: string; to: string }>): Promise<MT5Candle[]> {
    const params = new URLSearchParams({ symbol, timeframe, count: String(count) });
    if (range) {
      params.set('from', range.from);
      params.set('to', range.to);
    }

    let response: Response;
    try {
      response = await fetch(`/api/mt5/mcp/rates?${params.toString()}`, {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.timeout(this.STATUS_FETCH_TIMEOUT_MS),
      });
    } catch {
      throw new Error('Falha de rede ao consultar dados de gráfico');
    }

    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.success) {
      const message =
        (body?.error?.message as string | undefined) || `Falha ao buscar chart data (HTTP ${response.status})`;
      throw new Error(message);
    }

    const rawRates = Array.isArray(body.data?.rates) ? body.data.rates : [];
    return rawRates.map((raw: any) => this.normalizeMcpCandle(raw));
  }

  /** Tolerante a snake_case (atributos brutos do MetaTrader5) — mesma conversão de tempo já usada no handler CHART_DATA legado. */
  private normalizeMcpCandle(raw: any): MT5Candle {
    return {
      time: typeof raw.time === 'number' ? raw.time : new Date(raw.time).getTime() / 1000,
      open: Number(raw.open),
      high: Number(raw.high),
      low: Number(raw.low),
      close: Number(raw.close),
      volume: Number(raw.volume ?? raw.tick_volume ?? raw.real_volume ?? 0),
    };
  }
}

/** Mesmos sufixos excluídos do bridge Python legado (python/mt5_bridge.py:506) — classes fracionárias/especiais, não ações normais. */
const EQUITY_EXCLUDED_SUFFIXES = [
  'F',
  'ED',
  'EF',
  'P',
  'PC',
  'PD',
  'PE',
  'PG',
  'PH',
  'PJ',
  'PL',
  'PM',
  'PN',
  'PP',
  'PQ',
  'PR',
  'PS',
  'PT',
  'PU',
  'PV',
  'PW',
  'PX',
  'PY',
];

/**
 * Filtro puro de ações (equities) da B3 — mesma lógica antes inline em
 * fetchEquitiesFromSymbols(), extraída para ser testável isoladamente (sem
 * fetch, sem instância).
 */
export function filterB3EquityNames(rawSymbols: readonly unknown[]): string[] {
  return rawSymbols
    .filter((raw: any) => {
      const path: string = raw?.path ?? '';
      const name: string = raw?.name ?? raw?.symbol ?? '';
      return (
        path.startsWith('BOVESPA\\A VISTA\\') &&
        !EQUITY_EXCLUDED_SUFFIXES.some((suffix) => name.endsWith(suffix)) &&
        name.length <= 6
      );
    })
    .map((raw: any) => raw.name ?? raw.symbol)
    .sort();
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
