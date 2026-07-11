/**
 * Tipos e interfaces para o sistema de Machine Learning
 */

// Tipos de previsões
export type PredictionType = 'price' | 'trend' | 'volatility' | 'direction';

export interface MLModelConfig {
  id: string;
  name: string;
  type: PredictionType;
  version: string;
  status: 'training' | 'ready' | 'error' | 'disabled';
  accuracy?: number;
  lastTrained?: Date;
  features: string[];
}

export interface PricePrediction {
  symbol: string;
  timeframe: string;
  predictions: {
    timestamp: Date;
    price: number;
    confidence: number;
    upperBound?: number;
    lowerBound?: number;
  }[];
  model: string;
  generatedAt: Date;
}

export interface TrendPrediction {
  symbol: string;
  timeframe: string;
  direction: 'bullish' | 'bearish' | 'neutral';
  strength: number; // 0-100
  confidence: number; // 0-1
  timeframeHorizon: string; // ex: "1H", "4H", "1D"
  generatedAt: Date;
}

export interface VolatilityPrediction {
  symbol: string;
  timeframe: string;
  currentVolatility: number;
  predictedVolatility: number;
  changePercent: number;
  confidence: number;
  riskLevel: 'low' | 'medium' | 'high' | 'extreme';
  generatedAt: Date;
}

export interface AssetScore {
  symbol: string;
  overallScore: number; // 0-100
  trendScore: number; // 0-100
  momentumScore: number; // 0-100
  volatilityScore: number; // 0-100 (mais é melhor)
  sentimentScore: number; // 0-100
  patternScore: number; // 0-100
  predictionScore: number; // 0-100
  recommendation: 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell';
  confidence: number; // 0-1
  lastUpdated: Date;
}

export interface MLTrainingConfig {
  modelType: 'lstm' | 'transformer' | 'xgboost' | 'random_forest' | 'price_predictor' | 'trend_classifier';
  symbol: string;
  timeframe: string;
  lookbackPeriod?: number; // Número de velas históricas (legado)
  predictionHorizon?: number; // Número de períodos à frente (legado)
  trainingStartDate?: Date; // Legado
  trainingEndDate?: Date; // Legado
  validationSplit?: number; // 0-1 (legado)
  features?: string[]; // Legado
  hyperparameters?: Record<string, any>; // Legado
  // Novos campos para API atual
  epochs?: number; // Número de épocas (padrão: 100)
  sequenceLength?: number; // Comprimento da sequência (padrão: 100)
}

export interface MLTrainingResult {
  modelId: string;
  status: 'success' | 'error';
  metrics?: {
    accuracy?: number;
    mse?: number; // Mean Squared Error
    mae?: number; // Mean Absolute Error
    rmse?: number; // Root Mean Squared Error
    r2Score?: number;
    sharpeRatio?: number;
    maxDrawdown?: number;
    winRate?: number;
  };
  error?: string;
  trainedAt: Date;
}

export interface MLBacktestResult {
  modelId: string;
  symbol: string;
  timeframe: string;
  startDate: Date;
  endDate: Date;
  totalTrades: number;
  winRate: number;
  avgProfit: number;
  avgLoss: number;
  maxDrawdown: number;
  profitFactor: number;
  sharpeRatio: number;
  totalReturn: number;
  annualizedReturn: number;
  volatility: number;
  trades: BacktestTrade[];
}

export interface BacktestTrade {
  timestamp: Date;
  type: 'buy' | 'sell';
  price: number;
  quantity: number;
  profit: number;
  exitPrice?: number;
  exitTimestamp?: Date;
}

// Dados de treinamento
export interface TrainingData {
  symbol: string;
  timeframe: string;
  candles: CandleData[];
  features: FeatureData;
  labels: LabelData;
}

export interface CandleData {
  time: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface FeatureData {
  technical: TechnicalFeatures;
  price: PriceFeatures;
  volume: VolumeFeatures;
  time: TimeFeatures;
}

export interface TechnicalFeatures {
  sma: {
    ma7?: number;
    ma21?: number;
    ma50?: number;
    ma200?: number;
  };
  ema: {
    ema7?: number;
    ema21?: number;
    ema50?: number;
  };
  rsi?: number;
  macd?: {
    macd: number;
    signal: number;
    histogram: number;
  };
  bollingerBands?: {
    upper: number;
    middle: number;
    lower: number;
    bandwidth: number;
  };
  atr?: number;
  adx?: number;
  stochastic?: {
    k: number;
    d: number;
  };
  cci?: number;
}

export interface PriceFeatures {
  returns: number[];
  logReturns: number[];
  momentum: number;
  roc: number; // Rate of Change
  volatility: number;
  highLowRange: number;
  openCloseDiff: number;
}

export interface VolumeFeatures {
  volumeRatio: number;
  volumeTrend: number;
  obv?: number; // On-Balance Volume
  mfi?: number; // Money Flow Index
  vwma?: number; // Volume Weighted Moving Average
}

export interface TimeFeatures {
  hour: number;
  dayOfWeek: number;
  dayOfMonth: number;
  month: number;
  isWeekend: boolean;
  session: 'asian' | 'london' | 'newyork' | 'overlap';
}

export interface LabelData {
  futureReturn: number;
  direction: 1 | 0 | -1; // 1 = up, 0 = neutral, -1 = down
  volatility: number;
  high: number;
  low: number;
}

// Status do sistema ML
export interface MLSystemStatus {
  isTraining: boolean;
  activeModels: MLModelConfig[];
  queuedModels: string[];
  lastTrainingTime?: Date;
  dataStatus: {
    symbolsTracked: number;
    totalCandles: number;
    lastUpdate: Date;
  };
}

// Configuração de features
export interface FeatureConfig {
  enabled: boolean;
  lookbackPeriods: {
    short: number; // ex: 7
    medium: number; // ex: 21
    long: number; // ex: 50
  };
  includeTechnical: boolean;
  includePrice: boolean;
  includeVolume: boolean;
  includeTime: boolean;
  normalizeFeatures: boolean;
}
