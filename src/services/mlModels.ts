import type { Candle } from './historicalDataService';

export type Signal = 'BUY' | 'SELL' | 'HOLD';

export interface ModelPrediction {
  signal:     Signal;
  confidence: number;
  meta:       Record<string, number | string>;
}

function ema(closes: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = new Array(closes.length).fill(NaN);
  const start = period - 1;
  if (start >= closes.length) return result;
  result[start] = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = start + 1; i < closes.length; i++) {
    result[i] = closes[i] * k + result[i - 1] * (1 - k);
  }
  return result;
}

function sma(closes: number[], period: number): number[] {
  return closes.map((_, i) => {
    if (i < period - 1) return NaN;
    const slice = closes.slice(i - period + 1, i + 1);
    return slice.reduce((a, b) => a + b, 0) / period;
  });
}

export interface MACrossoverParams {
  fastPeriod: number;
  slowPeriod: number;
  useEMA:     boolean;
}

export function runMACrossover(candles: Candle[], params: Partial<MACrossoverParams> = {}): ModelPrediction {
  const { fastPeriod = 10, slowPeriod = 30, useEMA = true } = params;
  if (candles.length < slowPeriod + 2) {
    return { signal: 'HOLD', confidence: 0, meta: { error: 'insufficient data' } };
  }
  const closes = candles.map(c => c.close);
  const maFn = useEMA ? ema : sma;
  const fast = maFn(closes, fastPeriod);
  const slow = maFn(closes, slowPeriod);
  const last = closes.length - 1, prev = last - 1;
  const [fL, sL, fP, sP] = [fast[last], slow[last], fast[prev], slow[prev]];
  if ([fL, sL, fP, sP].some(isNaN)) {
    return { signal: 'HOLD', confidence: 0, meta: { error: 'NaN in MA' } };
  }
  const crossedUp = fP <= sP && fL > sL;
  const crossedDown = fP >= sP && fL < sL;
  const spread = Math.abs(fL - sL) / sL;
  let signal: Signal, confidence: number;
  if (crossedUp)        { signal = 'BUY';  confidence = Math.min(0.5 + spread * 100, 0.95); }
  else if (crossedDown) { signal = 'SELL'; confidence = Math.min(0.5 + spread * 100, 0.95); }
  else if (fL > sL)     { signal = 'BUY';  confidence = Math.min(0.3 + spread * 50, 0.75); }
  else if (fL < sL)     { signal = 'SELL'; confidence = Math.min(0.3 + spread * 50, 0.75); }
  else                  { signal = 'HOLD'; confidence = 0.1; }
  return { signal, confidence, meta: { fastMA: +fL.toFixed(5), slowMA: +sL.toFixed(5), lastClose: +closes[last].toFixed(5), fastPeriod, slowPeriod, maType: useEMA ? 'EMA' : 'SMA' } };
}

export interface LinearRegressionParams {
  lookback: number;
  horizon:  number;
}

export function runLinearRegression(candles: Candle[], params: Partial<LinearRegressionParams> = {}): ModelPrediction {
  const { lookback = 50, horizon = 5 } = params;
  if (candles.length < lookback) {
    return { signal: 'HOLD', confidence: 0, meta: { error: 'insufficient data' } };
  }
  const closes = candles.slice(-lookback).map(c => c.close);
  const n = closes.length;
  const xs = Array.from({ length: n }, (_, i) => i);
  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = closes.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((acc, x, i) => acc + x * closes[i], 0);
  const sumX2 = xs.reduce((acc, x) => acc + x * x, 0);
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return { signal: 'HOLD', confidence: 0, meta: { error: 'degenerate regression' } };
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  const predictedPrice = intercept + slope * (n - 1 + horizon);
  const currentPrice = closes[n - 1];
  const pctChange = (predictedPrice - currentPrice) / currentPrice;
  const yMean = sumY / n;
  const ssTot = closes.reduce((acc, y) => acc + (y - yMean) ** 2, 0);
  const ssRes = closes.reduce((acc, y, i) => acc + (y - (intercept + slope * xs[i])) ** 2, 0);
  const r2 = ssTot === 0 ? 0 : Math.max(0, 1 - ssRes / ssTot);
  const THRESHOLD = 0.001;
  let signal: Signal;
  if (pctChange > THRESHOLD) signal = 'BUY';
  else if (pctChange < -THRESHOLD) signal = 'SELL';
  else signal = 'HOLD';
  const confidence = Math.min(r2 * Math.abs(pctChange) * 500, 0.95);
  return { signal, confidence, meta: { slope: +slope.toFixed(8), intercept: +intercept.toFixed(5), r2: +r2.toFixed(4), predictedPrice: +predictedPrice.toFixed(5), currentPrice: +currentPrice.toFixed(5), pctChange: +(pctChange * 100).toFixed(4), horizon, lookback } };
}
