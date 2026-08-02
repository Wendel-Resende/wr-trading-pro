import { EventEmitter } from 'events';
import { SpreadPendingOrder, SpreadOrderStatus, SpreadCondition, SpreadSummary } from '@/types/spread';
import { mt5Service, Mt5TradingUnavailableError } from '@/services/mt5Service';
import { MT5Tick } from '@/types/mt5';

// Map DB status strings to SpreadOrderStatus enum
function dbStatusToEnum(status: string): SpreadOrderStatus {
  switch (status) {
    case 'PENDING': return SpreadOrderStatus.PENDING;
    case 'FILLED': return SpreadOrderStatus.EXECUTED;
    case 'CANCELLED': return SpreadOrderStatus.CANCELLED;
    case 'FAILED': return SpreadOrderStatus.FAILED;
    default: return SpreadOrderStatus.PENDING;
  }
}

// Map SpreadOrderStatus enum to DB status string
function enumToDbStatus(status: SpreadOrderStatus): string {
  switch (status) {
    case SpreadOrderStatus.PENDING: return 'PENDING';
    case SpreadOrderStatus.EXECUTED: return 'FILLED';
    case SpreadOrderStatus.CANCELLED: return 'CANCELLED';
    case SpreadOrderStatus.FAILED: return 'FAILED';
    default: return 'PENDING';
  }
}

// Map a DB row to SpreadPendingOrder shape
function dbRowToOrder(row: any): SpreadPendingOrder {
  return {
    id: row.id,
    symbol1: row.asset1?.symbol ?? row.assetId1,
    symbol2: row.asset2?.symbol ?? row.assetId2,
    action1: (row.type1 === 'BUY' ? 'buy' : 'sell') as 'buy' | 'sell',
    action2: (row.type2 === 'BUY' ? 'buy' : 'sell') as 'buy' | 'sell',
    quantity1: row.quantity1,
    quantity2: row.quantity2,
    price1: row.price1,
    price2: row.price2,
    targetSpread: row.automationTarget ?? 0,
    condition: (row.automationCondition as SpreadCondition) ?? 'greater_than',
    currentSpread: row.spreadValue ?? (row.price1 - row.price2),
    status: dbStatusToEnum(row.status),
    createdAt: new Date(row.createdAt),
    executedAt: row.filledAt ? new Date(row.filledAt) : undefined,
    order1Ticket: row.mt5OrderTicket1 ?? undefined,
    order2Ticket: row.mt5OrderTicket2 ?? undefined,
    triggered: false,
    executing: false,
    profit: undefined,
    error: undefined,
  };
}

class SpreadOrderService extends EventEmitter {
  private static instance: SpreadOrderService;
  private pendingOrders: SpreadPendingOrder[] = [];
  private executedOrders: SpreadPendingOrder[] = [];
  private isLoaded = false;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private readonly MONITOR_INTERVAL = 1000;
  private currentPrices: Map<string, number> = new Map();

  private constructor() {
    super();
    this.setupMT5Integration();
    // Load from DB asynchronously
    this.loadFromDatabase().catch(err =>
      console.error('[SpreadOrderService] Erro ao carregar do banco:', err)
    );
  }

  static getInstance(): SpreadOrderService {
    if (!SpreadOrderService.instance) {
      SpreadOrderService.instance = new SpreadOrderService();
    }
    return SpreadOrderService.instance;
  }

  // Load PENDING and FILLED orders from the database
  private async loadFromDatabase(): Promise<void> {
    if (this.isLoaded) return;
    this.isLoaded = true;
    if (typeof window === 'undefined') return;

    try {
      const [pendingRes, filledRes] = await Promise.all([
        fetch('/api/spread-orders?status=PENDING&limit=200'),
        fetch('/api/spread-orders?status=FILLED&limit=200'),
      ]);

      if (pendingRes.ok) {
        const json = await pendingRes.json();
        this.pendingOrders = (json.data ?? []).map(dbRowToOrder);
        console.log('[SpreadOrderService] Ordens pendentes carregadas:', this.pendingOrders.length);
      }

      if (filledRes.ok) {
        const json = await filledRes.json();
        this.executedOrders = (json.data ?? []).map(dbRowToOrder);
        console.log('[SpreadOrderService] Histórico carregado:', this.executedOrders.length);
      }

      this.emit('ordersUpdated', this.pendingOrders);
    } catch (error) {
      console.error('[SpreadOrderService] Erro ao carregar do banco:', error);
    }
  }

  // Configure MT5 integration for real-time spread updates
  private setupMT5Integration() {
    const handleTick = (tick: MT5Tick) => {
      if (tick.symbol && tick.bid) {
        this.currentPrices.set(tick.symbol, tick.bid);
        this.updateCurrentSpreads();
      }
    };

    mt5Service.on('tick', handleTick);

    // Subscribe to ticks when orders are updated
    this.on('ordersUpdated', (orders: SpreadPendingOrder[]) => {
      const symbols = new Set<string>();
      orders.forEach(order => {
        symbols.add(order.symbol1);
        symbols.add(order.symbol2);
      });
      symbols.forEach(symbol => mt5Service.subscribeTicks(symbol));
    });

    console.log('[SpreadOrderService] Integração com MT5 configurada');
  }

  // Recalculate current spread for all pending orders from live prices
  updateCurrentSpreads() {
    let updated = false;

    this.pendingOrders.forEach(order => {
      const price1 = this.currentPrices.get(order.symbol1);
      const price2 = this.currentPrices.get(order.symbol2);

      if (price1 !== undefined && price2 !== undefined) {
        const newSpread = price1 - price2;
        if (order.currentSpread !== newSpread) {
          order.currentSpread = newSpread;
          updated = true;
        }
      }
    });

    if (updated) {
      this.emit('spreadsUpdated', this.pendingOrders);
    }
  }

  // Check if spread condition is met
  private checkCondition(currentSpread: number, targetSpread: number, condition: SpreadCondition): boolean {
    switch (condition) {
      case 'greater_than': return currentSpread > targetSpread;
      case 'less_than': return currentSpread < targetSpread;
      case 'equal_to': return Math.abs(currentSpread - targetSpread) < 0.001;
      default: return false;
    }
  }

  // Calculate profit
  private calculateProfit(order: SpreadPendingOrder, executedSpread: number): number {
    const spreadDiff = Math.abs(executedSpread - order.targetSpread);
    const totalQuantity = order.quantity1 + order.quantity2;
    return spreadDiff * totalQuantity;
  }

  // Envio/alteração/fechamento de ordens está indisponível nesta versão —
  // nunca migrado ao MCP nativo. Lança incondicionalmente, sem criar body,
  // fazer POST, ler response, mutar arrays, emitir evento, logar ou
  // iniciar monitor.
  async addPendingOrder(
    order: Omit<SpreadPendingOrder, 'id' | 'createdAt' | 'currentSpread' | 'status'>
  ): Promise<SpreadPendingOrder> {
    void order;
    throw new Mt5TradingUnavailableError();
  }

  // Cancel a pending order — DELETE via API then remove locally
  async cancelOrder(orderId: string): Promise<void> {
    const res = await fetch(`/api/spread-orders/${orderId}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Falha ao cancelar ordem: HTTP ${res.status}`);
    }
    // Only mutate local state after successful API call
    this.pendingOrders = this.pendingOrders.filter(o => o.id !== orderId);
    this.executedOrders = this.executedOrders.filter(o => o.id !== orderId);
    this.emit('ordersUpdated', { pending: this.pendingOrders, executed: this.executedOrders });
  }

  // Mark order as executed — PATCH via API
  async markAsExecuted(orderId: string, tickets?: { order1?: number; order2?: number }, error?: string): Promise<boolean> {
    if (!error) {
      throw new Mt5TradingUnavailableError();
    }

    console.log('[SpreadOrderService] markAsExecuted chamado para ordem:', orderId);

    const index = this.pendingOrders.findIndex(o => o.id === orderId);
    if (index === -1) {
      console.error('[SpreadOrderService] Ordem não encontrada em pendingOrders!');
      return false;
    }

    const order = this.pendingOrders[index];
    const newStatus = error ? SpreadOrderStatus.FAILED : SpreadOrderStatus.EXECUTED;

    try {
      await fetch(`/api/spread-orders/${orderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: enumToDbStatus(newStatus),
          ...(tickets?.order1 ? { mt5OrderTicket1: tickets.order1 } : {}),
          ...(tickets?.order2 ? { mt5OrderTicket2: tickets.order2 } : {}),
        }),
      });
    } catch (err) {
      console.error('[SpreadOrderService] Erro ao atualizar ordem via API:', err);
    }

    order.executedAt = new Date();
    order.status = newStatus;

    if (error) {
      order.error = error;
      console.error('[SpreadOrderService] Ordem falhou:', orderId, error);
    } else {
      order.profit = this.calculateProfit(order, order.currentSpread);
      console.log('[SpreadOrderService] Ordem executada com sucesso:', orderId, 'Lucro:', order.profit);
    }

    if (tickets) {
      order.order1Ticket = tickets.order1;
      order.order2Ticket = tickets.order2;
    }

    this.executedOrders.unshift(order);
    this.pendingOrders.splice(index, 1);

    this.emit('ordersUpdated', this.pendingOrders);
    this.emit('historyUpdated', this.executedOrders);

    if (!error) {
      this.emit('orderExecuted', order);
    } else {
      this.emit('orderFailed', order);
    }

    return true;
  }

  // Mark order as failed
  async markAsFailed(orderId: string, error: string): Promise<void> {
    await this.markAsExecuted(orderId, undefined, error);
  }

  // Getters
  getPendingOrders(): SpreadPendingOrder[] {
    return [...this.pendingOrders];
  }

  getOrderById(orderId: string): SpreadPendingOrder | undefined {
    return this.pendingOrders.find(o => o.id === orderId);
  }

  getExecutedOrders(): SpreadPendingOrder[] {
    return [...this.executedOrders];
  }

  getSummary(): SpreadSummary {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayExecuted = this.executedOrders.filter(order => {
      const executedDate = new Date(order.executedAt!);
      return executedDate >= today && order.status === SpreadOrderStatus.EXECUTED;
    });

    const totalProfit = todayExecuted.reduce((sum, order) => sum + (order.profit || 0), 0);

    return {
      pendingOrders: this.pendingOrders.length,
      executedToday: todayExecuted.length,
      totalProfitToday: totalProfit,
    };
  }

  // Envio/alteração/fechamento de ordens está indisponível nesta versão —
  // nunca migrado ao MCP nativo. Garante que nenhum monitor fique ativo e
  // lança incondicionalmente, sem criar timer nem logar.
  startMonitoring() {
    this.stopMonitoring();
    throw new Mt5TradingUnavailableError();
  }

  // Stop monitoring interval
  stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      console.log('[SpreadOrderService] Monitoramento parado');
    }
  }

  // Envio/alteração/fechamento de ordens está indisponível nesta versão —
  // nunca migrado ao MCP nativo. Lança incondicionalmente, sem tentar
  // sendMT5Order/markAsExecuted/markAsFailed/fetch/emit/log.
  async executeSpreadOrder(
    order: SpreadPendingOrder
  ): Promise<{ success: boolean; tickets?: { order1?: number; order2?: number }; error?: string }> {
    void order;
    throw new Mt5TradingUnavailableError();
  }

  // Envio/alteração/fechamento de ordens está indisponível nesta versão
  // (Mt5TradingUnavailableError) — o monitoramento automático nunca deve
  // ler condição, marcar ordem como triggered/executing, nem chamar
  // executeSpreadOrder. Retorna imediatamente, sem efeito colateral.
  private async checkAndExecuteOrders() {
    return;
  }
}

// Export singleton
export const spreadOrderService = SpreadOrderService.getInstance();
