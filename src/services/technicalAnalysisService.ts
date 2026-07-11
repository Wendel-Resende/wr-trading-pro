import { ChartData, TechnicalIndicator } from '@/types';

// Calculate Simple Moving Average (SMA)
export function calculateSMA(data: ChartData[], period: number): number[] {
  const sma: number[] = [];
  
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      sma.push(NaN);
      continue;
    }
    
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += data[i - j].close;
    }
    sma.push(sum / period);
  }
  
  return sma;
}

// Calculate Exponential Moving Average (EMA)
export function calculateEMA(data: ChartData[], period: number): number[] {
  const ema: number[] = [];
  const multiplier = 2 / (period + 1);
  
  // Start with SMA for first EMA value
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += data[i].close;
  }
  ema.push(sum / period);
  
  // Calculate EMA for remaining values
  for (let i = period; i < data.length; i++) {
    const currentEMA = (data[i].close - ema[i - period]) * multiplier + ema[i - period];
    ema.push(currentEMA);
  }
  
  return ema;
}

// Calculate RSI (Relative Strength Index)
export function calculateRSI(data: ChartData[], period: number = 14): number[] {
  const rsi: number[] = [];
  const gains: number[] = [];
  const losses: number[] = [];
  
  // Calculate initial gains and losses
  for (let i = 1; i < data.length; i++) {
    const change = data[i].close - data[i - 1].close;
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);
  }
  
  // Calculate average gains and losses
  let avgGain = 0;
  let avgLoss = 0;
  
  for (let i = 0; i < period; i++) {
    avgGain += gains[i];
    avgLoss += losses[i];
  }
  
  avgGain /= period;
  avgLoss /= period;
  
  // Calculate RSI
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsi.push(100 - (100 / (1 + rs)));
  }
  
  // Fill beginning with NaN
  for (let i = 0; i < period; i++) {
    rsi.unshift(NaN);
  }
  
  return rsi;
}

// Calculate MACD (Moving Average Convergence Divergence)
export function calculateMACD(data: ChartData[], fastPeriod: number = 12, slowPeriod: number = 26, signalPeriod: number = 9): {
  macd: number[];
  signal: number[];
  histogram: number[];
} {
  const emaFast = calculateEMA(data, fastPeriod);
  const emaSlow = calculateEMA(data, slowPeriod);
  
  const macd: number[] = [];
  for (let i = 0; i < emaFast.length; i++) {
    macd.push(emaFast[i] - emaSlow[i]);
  }
  
  // Calculate signal line (EMA of MACD)
  const macdData: ChartData[] = macd.map((value, i) => ({
    time: data[i].time,
    open: value,
    high: value,
    low: value,
    close: value,
    volume: 0,
  }));
  
  const signal = calculateEMA(macdData, signalPeriod);
  
  // Calculate histogram
  const histogram: number[] = [];
  for (let i = 0; i < macd.length; i++) {
    histogram.push(macd[i] - (signal[i] || 0));
  }
  
  return { macd, signal, histogram };
}

// Calculate Bollinger Bands
export function calculateBollingerBands(data: ChartData[], period: number = 20, stdDev: number = 2): {
  upper: number[];
  middle: number[];
  lower: number[];
} {
  const sma = calculateSMA(data, period);
  const upper: number[] = [];
  const lower: number[] = [];
  
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      upper.push(NaN);
      lower.push(NaN);
      continue;
    }
    
    // Calculate standard deviation
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += Math.pow(data[i - j].close - sma[i], 2);
    }
    const std = Math.sqrt(sum / period);
    
    upper.push(sma[i] + stdDev * std);
    lower.push(sma[i] - stdDev * std);
  }
  
  return { upper, middle: sma, lower };
}

// Generate trading signal based on indicators
export function generateSignal(
  rsi: number,
  macd: number,
  signal: number,
  price: number,
  upperBand: number,
  lowerBand: number
): 'BUY' | 'SELL' | 'NEUTRAL' {
  let buySignals = 0;
  let sellSignals = 0;
  
  // RSI signals
  if (rsi < 30) buySignals++;
  if (rsi > 70) sellSignals++;
  
  // MACD signals
  if (macd > signal) buySignals++;
  if (macd < signal) sellSignals++;
  
  // Bollinger Bands signals
  if (price < lowerBand) buySignals++;
  if (price > upperBand) sellSignals++;
  
  if (buySignals > sellSignals) return 'BUY';
  if (sellSignals > buySignals) return 'SELL';
  return 'NEUTRAL';
}

// Calculate all technical indicators for a symbol
export function calculateAllIndicators(data: ChartData[]): {
  rsi: number[];
  macd: { macd: number[]; signal: number[]; histogram: number[] };
  bollinger: { upper: number[]; middle: number[]; lower: number[] };
  sma20: number[];
  sma50: number[];
  ema12: number[];
  ema26: number[];
} {
  return {
    rsi: calculateRSI(data),
    macd: calculateMACD(data),
    bollinger: calculateBollingerBands(data),
    sma20: calculateSMA(data, 20),
    sma50: calculateSMA(data, 50),
    ema12: calculateEMA(data, 12),
    ema26: calculateEMA(data, 26),
  };
}

// Get current technical analysis summary
export function getTechnicalAnalysisSummary(data: ChartData[]): {
  trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  strength: 'STRONG' | 'MODERATE' | 'WEAK';
  recommendation: 'BUY' | 'HOLD' | 'SELL';
  confidence: number;
  indicators: {
    rsi: number;
    macd: number;
    signal: number;
    price: number;
    upperBand: number;
    lowerBand: number;
  };
} {
  const indicators = calculateAllIndicators(data);
  const lastIndex = data.length - 1;
  
  const currentRSI = indicators.rsi[lastIndex];
  const currentMACD = indicators.macd.macd[lastIndex];
  const currentSignal = indicators.macd.signal[lastIndex];
  const currentPrice = data[lastIndex].close;
  const currentUpperBand = indicators.bollinger.upper[lastIndex];
  const currentLowerBand = indicators.bollinger.lower[lastIndex];
  
  const signal = generateSignal(
    currentRSI,
    currentMACD,
    currentSignal,
    currentPrice,
    currentUpperBand,
    currentLowerBand
  );
  
  // Determine trend
  const sma20 = indicators.sma20[lastIndex];
  const sma50 = indicators.sma50[lastIndex];
  let trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  
  if (currentPrice > sma20 && sma20 > sma50) {
    trend = 'BULLISH';
  } else if (currentPrice < sma20 && sma20 < sma50) {
    trend = 'BEARISH';
  }
  
  // Determine strength
  let strength: 'STRONG' | 'MODERATE' | 'WEAK' = 'WEAK';
  const rsiDistance = Math.abs(currentRSI - 50);
  
  if (rsiDistance > 30) {
    strength = 'STRONG';
  } else if (rsiDistance > 15) {
    strength = 'MODERATE';
  }
  
  // Calculate confidence
  let confidence = 50;
  if (signal === 'BUY') {
    confidence += (50 - currentRSI) / 2;
    if (currentMACD > currentSignal) confidence += 10;
  } else if (signal === 'SELL') {
    confidence += (currentRSI - 50) / 2;
    if (currentMACD < currentSignal) confidence += 10;
  }
  confidence = Math.min(100, Math.max(0, confidence));
  
  return {
    trend,
    strength,
    recommendation: signal === 'BUY' ? 'BUY' : signal === 'SELL' ? 'SELL' : 'HOLD',
    confidence,
    indicators: {
      rsi: currentRSI,
      macd: currentMACD,
      signal: currentSignal,
      price: currentPrice,
      upperBand: currentUpperBand,
      lowerBand: currentLowerBand,
    },
  };
}