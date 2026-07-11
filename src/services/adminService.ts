import {
  MLModelMetrics,
  SystemMetrics,
  OperationLog,
  PerformanceData,
  SystemAlert,
  DashboardStats,
  FilterOptions,
} from '@/types/admin';

/**
 * Admin Service - Gerenciamento de métricas e logs do sistema
 */
class AdminService {
  private mlModels: Map<string, MLModelMetrics> = new Map();
  private systemMetrics: SystemMetrics[] = [];
  private operationLogs: OperationLog[] = [];
  private performanceData: PerformanceData[] = [];
  private alerts: SystemAlert[] = [];
  private maxLogs = 1000;
  private maxMetrics = 1000;

  constructor() {
    this.initializeMockData();
  }

  /**
   * Inicializar dados de exemplo
   */
  private initializeMockData(): void {
    // Modelos ML de exemplo
    const mockModels: MLModelMetrics[] = [
      {
        id: '1',
        name: 'LSTM Price Predictor',
        type: 'LSTM',
        accuracy: 0.75,
        sharpeRatio: 1.8,
        maxDrawdown: -12.5,
        totalTrades: 1250,
        winRate: 0.62,
        avgProfit: 150.0,
        avgLoss: -95.0,
        profitFactor: 1.58,
        lastUpdated: new Date(),
        isActive: true,
      },
      {
        id: '2',
        name: 'GRU Trend Analyzer',
        type: 'GRU',
        accuracy: 0.72,
        sharpeRatio: 1.5,
        maxDrawdown: -15.2,
        totalTrades: 980,
        winRate: 0.58,
        avgProfit: 135.0,
        avgLoss: -110.0,
        profitFactor: 1.23,
        lastUpdated: new Date(),
        isActive: true,
      },
      {
        id: '3',
        name: 'Transformer Sentiment',
        type: 'TRANSFORMER',
        accuracy: 0.68,
        sharpeRatio: 1.2,
        maxDrawdown: -18.7,
        totalTrades: 750,
        winRate: 0.55,
        avgProfit: 120.0,
        avgLoss: -125.0,
        profitFactor: 1.05,
        lastUpdated: new Date(),
        isActive: false,
      },
      {
        id: '4',
        name: 'Ensemble Strategy',
        type: 'ENSEMBLE',
        accuracy: 0.78,
        sharpeRatio: 2.1,
        maxDrawdown: -10.3,
        totalTrades: 2100,
        winRate: 0.65,
        avgProfit: 165.0,
        avgLoss: -85.0,
        profitFactor: 1.94,
        lastUpdated: new Date(),
        isActive: true,
      },
    ];

    mockModels.forEach(model => {
      this.mlModels.set(model.id, model);
    });

    // Métricas de sistema de exemplo
    const now = new Date();
    for (let i = 0; i < 24; i++) {
      const timestamp = new Date(now.getTime() - i * 3600000);
      this.systemMetrics.push(
        {
          id: `uptime-${i}`,
          metricName: 'UPTIME',
          value: 99.9 - Math.random() * 0.5,
          unit: '%',
          timestamp,
        },
        {
          id: `latency-${i}`,
          metricName: 'LATENCY',
          value: 50 + Math.random() * 30,
          unit: 'ms',
          timestamp,
        },
        {
          id: `cpu-${i}`,
          metricName: 'CPU_USAGE',
          value: 30 + Math.random() * 40,
          unit: '%',
          timestamp,
        },
        {
          id: `memory-${i}`,
          metricName: 'MEMORY_USAGE',
          value: 40 + Math.random() * 30,
          unit: '%',
          timestamp,
        },
      );
    }

    // Logs de operação de exemplo
    const mockLogs: OperationLog[] = [
      {
        id: '1',
        type: 'ORDER',
        severity: 'INFO',
        message: 'Ordem de compra enviada: PETR4 @ 34.50',
        timestamp: new Date(Date.now() - 3600000),
        asset: 'PETR4',
      },
      {
        id: '2',
        type: 'TRADE',
        severity: 'INFO',
        message: 'Trade executado: VALE3 @ 66.50',
        timestamp: new Date(Date.now() - 7200000),
        asset: 'VALE3',
      },
      {
        id: '3',
        type: 'ALERT',
        severity: 'WARNING',
        message: 'Drawdown acima de 10% no portfólio',
        timestamp: new Date(Date.now() - 10800000),
      },
      {
        id: '4',
        type: 'ERROR',
        severity: 'ERROR',
        message: 'Falha na conexão com ProfitDLL',
        timestamp: new Date(Date.now() - 14400000),
      },
      {
        id: '5',
        type: 'SYSTEM',
        severity: 'INFO',
        message: 'Sistema iniciado com sucesso',
        timestamp: new Date(Date.now() - 18000000),
      },
    ];

    this.operationLogs = mockLogs;

    // Alertas de sistema de exemplo
    const mockAlerts: SystemAlert[] = [
      {
        id: '1',
        type: 'PERFORMANCE',
        severity: 'WARNING',
        title: 'Win Rate Abaixo do Esperado',
        message: 'O modelo LSTM está com win rate de 58% nos últimos 7 dias, abaixo da meta de 65%.',
        timestamp: new Date(Date.now() - 86400000),
        isRead: false,
        isResolved: false,
      },
      {
        id: '2',
        type: 'SYSTEM',
        severity: 'ERROR',
        title: 'Alta Latência Detectada',
        message: 'Latência média de 150ms detectada nos últimos 5 minutos.',
        timestamp: new Date(Date.now() - 3600000),
        isRead: false,
        isResolved: false,
      },
      {
        id: '3',
        type: 'DATA',
        severity: 'INFO',
        title: 'Atualização de Dados',
        message: 'Dados históricos atualizados com sucesso.',
        timestamp: new Date(Date.now() - 1800000),
        isRead: true,
        isResolved: true,
      },
    ];

    this.alerts = mockAlerts;
  }

  /**
   * Obter todos os modelos ML
   */
  getMLModels(): MLModelMetrics[] {
    return Array.from(this.mlModels.values());
  }

  /**
   * Obter modelo ML por ID
   */
  getMLModel(id: string): MLModelMetrics | undefined {
    return this.mlModels.get(id);
  }

  /**
   * Atualizar modelo ML
   */
  updateMLModel(id: string, updates: Partial<MLModelMetrics>): void {
    const model = this.mlModels.get(id);
    if (model) {
      const updated = { ...model, ...updates, lastUpdated: new Date() };
      this.mlModels.set(id, updated);
    }
  }

  /**
   * Ativar/desativar modelo ML
   */
  toggleMLModel(id: string): void {
    const model = this.mlModels.get(id);
    if (model) {
      const updated = { ...model, isActive: !model.isActive, lastUpdated: new Date() };
      this.mlModels.set(id, updated);
    }
  }

  /**
   * Obter métricas do sistema
   */
  getSystemMetrics(metricName?: string, limit: number = 100): SystemMetrics[] {
    let metrics = this.systemMetrics;
    if (metricName) {
      metrics = metrics.filter(m => m.metricName === metricName);
    }
    return metrics.slice(-limit).reverse();
  }

  /**
   * Adicionar métrica do sistema
   */
  addSystemMetric(metric: SystemMetrics): void {
    this.systemMetrics.push(metric);
    if (this.systemMetrics.length > this.maxMetrics) {
      this.systemMetrics = this.systemMetrics.slice(-this.maxMetrics);
    }
  }

  /**
   * Obter logs de operação
   */
  getOperationLogs(filters?: FilterOptions, limit: number = 100): OperationLog[] {
    let logs = [...this.operationLogs];
    
    if (filters) {
      if (filters.type) {
        logs = logs.filter(log => log.type === filters.type);
      }
      if (filters.severity) {
        logs = logs.filter(log => log.severity === filters.severity);
      }
      if (filters.asset) {
        logs = logs.filter(log => log.asset === filters.asset);
      }
      if (filters.startDate) {
        logs = logs.filter(log => log.timestamp >= filters.startDate!);
      }
      if (filters.endDate) {
        logs = logs.filter(log => log.timestamp <= filters.endDate!);
      }
    }
    
    return logs.slice(-limit).reverse();
  }

  /**
   * Adicionar log de operação
   */
  addOperationLog(log: OperationLog): void {
    this.operationLogs.push(log);
    if (this.operationLogs.length > this.maxLogs) {
      this.operationLogs = this.operationLogs.slice(-this.maxLogs);
    }
  }

  /**
   * Obter alertas do sistema
   */
  getAlerts(unreadOnly: boolean = false): SystemAlert[] {
    let alerts = [...this.alerts];
    if (unreadOnly) {
      alerts = alerts.filter(alert => !alert.isRead);
    }
    return alerts.reverse();
  }

  /**
   * Marcar alerta como lido
   */
  markAlertAsRead(id: string): void {
    const alert = this.alerts.find(a => a.id === id);
    if (alert) {
      alert.isRead = true;
    }
  }

  /**
   * Marcar alerta como resolvido
   */
  markAlertAsResolved(id: string): void {
    const alert = this.alerts.find(a => a.id === id);
    if (alert) {
      alert.isResolved = true;
    }
  }

  /**
   * Adicionar alerta do sistema
   */
  addAlert(alert: SystemAlert): void {
    this.alerts.push(alert);
  }

  /**
   * Obter dados de performance
   */
  getPerformanceData(limit: number = 100): PerformanceData[] {
    return this.performanceData.slice(-limit).reverse();
  }

  /**
   * Adicionar dados de performance
   */
  addPerformanceData(data: PerformanceData): void {
    this.performanceData.push(data);
    if (this.performanceData.length > this.maxMetrics) {
      this.performanceData = this.performanceData.slice(-this.maxMetrics);
    }
  }

  /**
   * Obter estatísticas do dashboard
   */
  getDashboardStats(): DashboardStats {
    const models = this.getMLModels();
    const activeModels = models.filter(m => m.isActive);
    
    const totalTrades = activeModels.reduce((sum, m) => sum + m.totalTrades, 0);
    const avgWinRate = activeModels.reduce((sum, m) => sum + m.winRate, 0) / activeModels.length;
    const totalProfit = activeModels.reduce((sum, m) => sum + (m.avgProfit * m.totalTrades * m.winRate), 0);
    const totalLoss = activeModels.reduce((sum, m) => sum + (m.avgLoss * m.totalTrades * (1 - m.winRate)), 0);
    const avgSharpeRatio = activeModels.reduce((sum, m) => sum + m.sharpeRatio, 0) / activeModels.length;
    const maxDrawdown = Math.min(...activeModels.map(m => m.maxDrawdown));
    
    const uptimeMetrics = this.getSystemMetrics('UPTIME', 24);
    const avgUptime = uptimeMetrics.reduce((sum, m) => sum + m.value, 0) / uptimeMetrics.length;
    
    const latencyMetrics = this.getSystemMetrics('LATENCY', 24);
    const avgLatency = latencyMetrics.reduce((sum, m) => sum + m.value, 0) / latencyMetrics.length;
    
    const errorLogs = this.getOperationLogs({ severity: 'ERROR' }, 100);
    const totalLogs = this.getOperationLogs({}, 100);
    const errorRate = (errorLogs.length / totalLogs.length) * 100;

    return {
      totalTrades,
      winRate: avgWinRate,
      totalProfit,
      totalLoss,
      profitFactor: totalProfit / Math.abs(totalLoss),
      maxDrawdown,
      sharpeRatio: avgSharpeRatio,
      uptime: avgUptime,
      avgLatency,
      errorRate,
    };
  }

  /**
   * Exportar logs
   */
  exportLogs(filters?: FilterOptions): string {
    const logs = this.getOperationLogs(filters);
    return JSON.stringify(logs, null, 2);
  }

  /**
   * Exportar métricas
   */
  exportMetrics(metricName?: string): string {
    const metrics = this.getSystemMetrics(metricName);
    return JSON.stringify(metrics, null, 2);
  }

  /**
   * Limpar logs antigos
   */
  clearOldLogs(days: number): void {
    const cutoffDate = new Date(Date.now() - days * 86400000);
    this.operationLogs = this.operationLogs.filter(log => log.timestamp >= cutoffDate);
    this.systemMetrics = this.systemMetrics.filter(metric => metric.timestamp >= cutoffDate);
    this.performanceData = this.performanceData.filter(data => data.timestamp >= cutoffDate);
  }

  /**
   * Limpar alertas resolvidos
   */
  clearResolvedAlerts(): void {
    this.alerts = this.alerts.filter(alert => !alert.isResolved);
  }
}

// Export singleton instance
export const adminService = new AdminService();
export default AdminService;