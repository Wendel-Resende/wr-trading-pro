export interface Asset {
  id: string;
  symbol: string;
  name: string;
  type: 'STOCK' | 'ETF' | 'CRYPTO' | 'FOREX';
  exchange: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Position {
  id: string;
  assetId: string;
  asset?: Asset;
  quantity: number;
  avgPrice: number;
  currentPrice: number;
  pnl: number;
  status: 'OPEN' | 'CLOSED';
  openedAt: Date;
  closedAt?: Date;
}

export interface Order {
  id: string;
  assetId: string;
  asset?: Asset;
  type: 'BUY' | 'SELL';
  orderType: 'MARKET' | 'LIMIT' | 'STOP';
  quantity: number;
  price?: number;
  status: 'PENDING' | 'FILLED' | 'CANCELLED' | 'REJECTED';
  createdAt: Date;
  filledAt?: Date;
}

export interface Prediction {
  id: string;
  assetId: string;
  asset?: Asset;
  modelType: 'LSTM' | 'GRU' | 'TRANSFORMER' | 'ENSEMBLE';
  prediction: 'BUY' | 'HOLD' | 'SELL';
  confidence: number;
  targetPrice?: number;
  timeframe: '1M' | '5M' | '15M' | '1H' | '1D';
  createdAt: Date;
}

export interface MarketData {
  id: string;
  assetId: string;
  asset?: Asset;
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: bigint;
}

export interface TechnicalIndicator {
  id: string;
  assetId: string;
  indicator: 'RSI' | 'MACD' | 'BOLLINGER' | 'SMA' | 'EMA';
  value: number;
  signal: 'BUY' | 'SELL' | 'NEUTRAL';
  timestamp: Date;
}

export interface Alert {
  id: string;
  type: 'PRICE' | 'VOLUME' | 'INDICATOR' | 'RISK';
  message: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  isRead: boolean;
  createdAt: Date;
}

// AIProvider e DataSource removidos em 2026-07-14 junto com os modelos
// Prisma correspondentes — segredos não são persistidos no banco.

export interface SystemMetrics {
  id: string;
  metricName: string;
  value: number;
  timestamp: Date;
}

export interface TickerData {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  high: number;
  low: number;
  timestamp: Date;
  digits?: number;  // Número de casas decimais do símbolo (do MT5)
}

export interface OrderBookEntry {
  price: number;
  quantity: number;
  orders: number;
}

export interface OrderBook {
  symbol: string;
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
  timestamp: Date;
}

export interface ChartData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Recommendation {
  symbol: string;
  action: 'BUY' | 'HOLD' | 'SELL';
  score: number;
  confidence: 'Baixa' | 'Média' | 'Alta';
  reasons: string[];
  targetPrice?: number;
  stopLoss?: number;
}
