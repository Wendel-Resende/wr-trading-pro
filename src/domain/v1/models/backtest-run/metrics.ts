/**
 * Métricas do backtest, extraídas de `index.ts` para poderem ser
 * recomputadas sobre conjuntos de trades reordenados (Monte Carlo) sem
 * duplicar a fórmula. Movimento mecânico: nenhum número muda.
 */
import type { BacktestMetrics, BacktestTrade } from './index';

export function computeMetrics(trades: readonly BacktestTrade[], periodsPerYear: number): BacktestMetrics {
  const n = trades.length;
  const totalNetPnl = trades.reduce((sum, t) => sum + t.netPnl, 0);
  const returns = trades.map((t) => t.netReturn);
  const totalNetReturn = returns.reduce((sum, r) => sum + r, 0);
  const meanReturn = n > 0 ? totalNetReturn / n : 0;
  const variance = n > 1 ? returns.reduce((sum, r) => sum + (r - meanReturn) ** 2, 0) / (n - 1) : 0;
  const stdDevReturn = Math.sqrt(variance);

  // R-BT-4: Sharpe uses sqrt(periodsPerYear) of the REAL timeframe, never a fixed sqrt(252).
  const sharpe = stdDevReturn > 0 ? (meanReturn / stdDevReturn) * Math.sqrt(periodsPerYear) : 0;

  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const trade of trades) {
    equity += trade.netPnl;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.min(maxDrawdown, equity - peak);
  }

  const wins = trades.filter((t) => t.netPnl > 0).length;
  const winRate = n > 0 ? wins / n : 0;

  return Object.freeze({
    trades: n,
    totalNetPnl,
    totalNetReturn,
    meanReturn,
    stdDevReturn,
    sharpe,
    periodsPerYear,
    maxDrawdown,
    winRate,
  });
}
