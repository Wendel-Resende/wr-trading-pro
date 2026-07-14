import type { Candle } from './historicalDataService';
import type { ModelPrediction } from './mlModels';
import type { BacktestParams, BacktestResult, Trade } from './backtesting';
import {
  runDeterministicBacktest,
  type BacktestBar,
  type BacktestSignalInput,
} from '@/domain/v1/models/backtest-run';

type ModelFn = (candles: Candle[], params?: Record<string, unknown>) => ModelPrediction;

const BARS_PER_YEAR: Record<string, number> = {
  M5: 70_992,
  M15: 23_664,
  M30: 11_832,
  H1: 1_972,
  H4: 493,
  D1: 252,
};

/**
 * Adapta o motor determinístico de backtest (src/domain/v1/models/backtest-run,
 * que corrige CR-9: sinal em bar[t] -> entrada em open[t+1]) para a interface
 * BacktestResult usada pela UI. Substitui `runBacktest` de `./backtesting`,
 * que tem lookahead (sinal e entrada na mesma barra).
 */
export function runBacktestV2(
  candles: Candle[],
  modelFn: ModelFn,
  modelParams: Record<string, unknown> = {},
  btParams: Partial<BacktestParams> = {},
  timeframe = 'H1',
): BacktestResult {
  const { initialCapital = 10_000, positionSizePct = 0.1, stopLossPct = 0.01, takeProfitPct = 0.02, minConfidence = 0.4, warmupBars = 50 } = btParams;

  const bars: BacktestBar[] = candles.map((c) => {
    const time = c.time.toISOString();
    return { time, open: c.open, high: c.high, low: c.low, close: c.close, knowledgeTime: time };
  });

  const signals: BacktestSignalInput[] = [];
  for (let i = warmupBars; i < candles.length; i++) {
    const { signal, confidence } = modelFn(candles.slice(0, i + 1), modelParams as never);
    if (signal === 'HOLD' || confidence < minConfidence) continue;
    const close = candles[i].close;
    const direction = signal;
    const stopPrice = direction === 'BUY' ? close * (1 - stopLossPct) : close * (1 + stopLossPct);
    const takeProfitPrice = direction === 'BUY' ? close * (1 + takeProfitPct) : close * (1 - takeProfitPct);
    signals.push({ barTime: bars[i].time, direction, knowledgeTime: bars[i].time, stopPrice, takeProfitPrice });
  }

  const periodsPerYear = BARS_PER_YEAR[timeframe] ?? BARS_PER_YEAR.H1;

  const { trades: engineTrades, metrics } = runDeterministicBacktest({
    bars,
    signals,
    costs: { fixedBrokerage: 0, emolumentsPct: 0, spreadBps: 0, slippageBps: 0, lotSize: 1 },
    periodsPerYear,
    entryRule: 'open_next_bar',
  });

  // Recompoe capital/equity aplicando o tamanho de posição sobre o capital vigente,
  // preservando a semântica de sizing que a UI já exibe (compounding trade a trade).
  let capital = initialCapital;
  let peak = initialCapital;
  let maxDrawdown = 0;
  const equityCurve: number[] = [];
  const trades: Trade[] = [];

  engineTrades.forEach((t, index) => {
    const notional = capital * positionSizePct;
    const pnl = notional * t.netReturn;
    capital += pnl;
    equityCurve.push(capital);
    if (capital > peak) peak = capital;
    const dd = peak > 0 ? (peak - capital) / peak : 0;
    if (dd > maxDrawdown) maxDrawdown = dd;

    trades.push({
      entryBar: index,
      exitBar: index,
      direction: t.direction === 'BUY' ? 'LONG' : 'SHORT',
      entryPrice: t.entryPrice,
      exitPrice: t.exitPrice,
      pnl,
      pnlPct: t.netReturn,
      exitReason: t.exitReason === 'STOP' ? 'SL' : t.exitReason === 'TAKE_PROFIT' ? 'TP' : 'END',
    });
  });

  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const grossProfit = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));
  const profitFactor = grossLoss === 0 ? (grossProfit > 0 ? Infinity : 1) : grossProfit / grossLoss;

  return {
    trades,
    totalReturn: (capital - initialCapital) / initialCapital,
    winRate: metrics.winRate,
    maxDrawdown,
    sharpeRatio: +metrics.sharpe.toFixed(4),
    totalTrades: metrics.trades,
    profitFactor: +profitFactor.toFixed(4),
    finalCapital: +capital.toFixed(2),
    equityCurve,
  };
}
