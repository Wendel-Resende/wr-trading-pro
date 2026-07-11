export interface MetricCard {
  title: string;
  value: string | number;
  unit?: string;
  trend?: {
    value: number;
    direction: 'up' | 'down';
    period: string;
  };
  status?: 'success' | 'warning' | 'error' | 'neutral';
  icon?: string;
}

export interface ChartDataPoint {
  timestamp: string;
  value: number;
  label?: string;
}

export interface MetricSeries {
  name: string;
  data: ChartDataPoint[];
  color?: string;
}

export interface SystemMetrics {
  cpuUsage: number;
  memoryUsage: number;
  memoryTotal: number;
  uptime: number;
  nodeVersion: string;
}

export interface MT5Metrics {
  connected: boolean;
  latency: number;
  uptime: number;
  messagesReceived: number;
  errors: number;
}

export interface OrderMetrics {
  ordersSent: number;
  ordersConfirmed: number;
  ordersRejected: number;
  successRate: number;
  volumeTraded: number;
  avgExecutionTime: number;
}

export interface AIMetrics {
  requestsTotal: number;
  requestsSuccess: number;
  requestsError: number;
  avgResponseTime: number;
  tokensUsed: number;
  estimatedCost: number;
}

export interface AlertsSummary {
  total: number;
  byType: {
    price: number;
    volume: number;
    indicator: number;
  };
  bySeverity: {
    low: number;
    medium: number;
    high: number;
  };
}
