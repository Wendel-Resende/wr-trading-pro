import type { Candle } from './historicalDataService';
import type { ModelPrediction } from './mlModels';

export interface BacktestParams {
  initialCapital:  number;
  positionSizePct: number;
  stopLossPct:     number;
  takeProfitPct:   number;
  minConfidence:   number;
  warmupBars:      number;
}

export interface Trade {
  entryBar: number; exitBar: number;
  direction: 'LONG' | 'SHORT';
  entryPrice: number; exitPrice: number;
  pnl: number; pnlPct: number;
  exitReason: 'TP' | 'SL' | 'END' | 'SIGNAL_FLIP';
}

export interface BacktestResult {
  trades: Trade[];
  totalReturn: number;
  winRate: number;
  maxDrawdown: number;
  sharpeRatio: number;
  totalTrades: number;
  profitFactor: number;
  finalCapital: number;
  equityCurve: number[];
}

type ModelFn = (candles: Candle[], params?: Record<string, unknown>) => ModelPrediction;

export function runBacktest(candles: Candle[], modelFn: ModelFn, modelParams: Record<string, unknown> = {}, btParams: Partial<BacktestParams> = {}): BacktestResult {
  const { initialCapital = 10_000, positionSizePct = 0.1, stopLossPct = 0.01, takeProfitPct = 0.02, minConfidence = 0.4, warmupBars = 50 } = btParams;
  let capital = initialCapital, peakCap = initialCapital, maxDD = 0;
  const trades: Trade[] = [], equity: number[] = [];
  let openTrade: { direction: 'LONG'|'SHORT'; entryBar: number; entryPrice: number; size: number } | null = null;

  for (let i = warmupBars; i < candles.length; i++) {
    const price = candles[i].close;
    if (openTrade) {
      const { direction, entryPrice, size, entryBar } = openTrade;
      const signedMove = direction === 'LONG' ? (price - entryPrice) / entryPrice : (entryPrice - price) / entryPrice;
      let closed = false, exitReason: Trade['exitReason'] = 'SIGNAL_FLIP';
      if (signedMove <= -stopLossPct)  { exitReason = 'SL'; closed = true; }
      if (signedMove >= takeProfitPct) { exitReason = 'TP'; closed = true; }
      if (closed) {
        const pnl = direction === 'LONG' ? size * (price - entryPrice) : size * (entryPrice - price);
        capital += pnl;
        trades.push({ entryBar, exitBar: i, direction, entryPrice, exitPrice: price, pnl, pnlPct: pnl / (size * entryPrice), exitReason });
        openTrade = null;
      }
    }
    const { signal, confidence } = modelFn(candles.slice(0, i + 1), modelParams as never);
    if (openTrade && confidence >= minConfidence) {
      const { direction, entryPrice, size, entryBar } = openTrade;
      if ((direction === 'LONG' && signal === 'SELL') || (direction === 'SHORT' && signal === 'BUY')) {
        const pnl = direction === 'LONG' ? size * (price - entryPrice) : size * (entryPrice - price);
        capital += pnl;
        trades.push({ entryBar, exitBar: i, direction, entryPrice, exitPrice: price, pnl, pnlPct: pnl / (size * entryPrice), exitReason: 'SIGNAL_FLIP' });
        openTrade = null;
      }
    }
    if (!openTrade && confidence >= minConfidence && signal !== 'HOLD') {
      openTrade = { direction: signal === 'BUY' ? 'LONG' : 'SHORT', entryBar: i, entryPrice: price, size: (capital * positionSizePct) / price };
    }
    const unrealised = openTrade ? (openTrade.direction === 'LONG' ? openTrade.size * (price - openTrade.entryPrice) : openTrade.size * (openTrade.entryPrice - price)) : 0;
    const equityNow = capital + unrealised;
    equity.push(equityNow);
    if (equityNow > peakCap) peakCap = equityNow;
    const dd = (peakCap - equityNow) / peakCap;
    if (dd > maxDD) maxDD = dd;
  }

  if (openTrade) {
    const price = candles[candles.length - 1].close;
    const { direction, entryPrice, size, entryBar } = openTrade;
    const pnl = direction === 'LONG' ? size * (price - entryPrice) : size * (entryPrice - price);
    capital += pnl;
    trades.push({ entryBar, exitBar: candles.length - 1, direction, entryPrice, exitPrice: price, pnl, pnlPct: pnl / (size * entryPrice), exitReason: 'END' });
  }

  const wins = trades.filter(t => t.pnl > 0), losses = trades.filter(t => t.pnl <= 0);
  const grossProfit = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));
  const profitFactor = grossLoss === 0 ? (grossProfit > 0 ? Infinity : 1) : grossProfit / grossLoss;
  const dailyReturns = equity.slice(1).map((e, i) => (e - equity[i]) / equity[i]);
  const meanR = dailyReturns.length ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length : 0;
  const stdR = dailyReturns.length > 1 ? Math.sqrt(dailyReturns.reduce((a, r) => a + (r - meanR) ** 2, 0) / (dailyReturns.length - 1)) : 0;
  const sharpeRatio = stdR === 0 ? 0 : (meanR / stdR) * Math.sqrt(252);

  return { trades, totalReturn: (capital - initialCapital) / initialCapital, winRate: trades.length ? wins.length / trades.length : 0, maxDrawdown: maxDD, sharpeRatio: +sharpeRatio.toFixed(4), totalTrades: trades.length, profitFactor: +profitFactor.toFixed(4), finalCapital: +capital.toFixed(2), equityCurve: equity };
}
