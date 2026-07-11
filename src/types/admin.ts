export interface MLModelMetrics {
  id: string;
  name: string;
  type: 'LSTM' | 'GRU' | 'TRANSFORMER' | 'ENSEMBLE';
  accuracy: number;
  sharpeRatio: number;
  maxDrawdown: number;
  totalTrades: number;
  winRate: number;
  avgProfit: number;
  avgLoss: number;
  profitFactor: number;
  lastUpdated: Date;
  isActive: boolean;
}

export interface SystemMetrics {
  id: string;
  metricName: 'UPTIME' | 'LATENCY' | 'CPU_USAGE' | 'MEMORY_USAGE' | 'API_CALLS' | 'ERROR_RATE';
  value: number;
  unit: string;
  timestamp: Date;
}

export interface OperationLog {
  id: string;
  type: 'ORDER' | 'TRADE' | 'POSITION' | 'ALERT' | 'SYSTEM' | 'ERROR';
  severity: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
  message: string;
  details?: Record<string, unknown>;
  timestamp: Date;
  userId?: string;
  asset?: string;
}

export interface PerformanceData {
  timestamp: Date;
  portfolioValue: number;
  profit: number;
  drawdown: number;
  sharpeRatio: number;
}

export interface SystemAlert {
  id: string;
  type: 'SYSTEM' | 'PERFORMANCE' | 'SECURITY' | 'DATA';
  severity: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
  title: string;
  message: string;
  timestamp: Date;
  isRead: boolean;
  isResolved: boolean;
}

export interface DashboardStats {
  totalTrades: number;
  winRate: number;
  totalProfit: number;
  totalLoss: number;
  profitFactor: number;
  maxDrawdown: number;
  sharpeRatio: number;
  uptime: number;
  avgLatency: number;
  errorRate: number;
}

export interface FilterOptions {
  type?: string;
  severity?: string;
  asset?: string;
  startDate?: Date;
  endDate?: Date;
  userId?: string;
}