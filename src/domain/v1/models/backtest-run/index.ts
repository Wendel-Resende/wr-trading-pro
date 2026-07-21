import { compareInstants, isStrictlyAfter, parseInstant } from '../../time';

/**
 * BacktestRun (Fase 5 / Item 4): persisted result of a deterministic
 * backtest execution. This file also hosts the deterministic engine
 * itself (`runDeterministicBacktest`) — a PURE function with no I/O, no
 * clock reads, and no randomness. All point-in-time data loading
 * happens in the application layer BEFORE the arrays reach this engine
 * (R-BT-7); the engine only re-asserts the invariant defensively.
 *
 * Corrects, in order:
 *  - CR-9 / R-BT-1: signal at bar[t] -> entry at open[t+1]. Never the
 *    same bar that produced the signal.
 *  - A18 / R-BT-2: stop/take-profit are evaluated intrabar using
 *    high/low, not only the close.
 *  - A19 / R-BT-3: real costs — fixed brokerage + emoluments (%) +
 *    spread (bps) + slippage (bps), applied per lot.
 *  - A18 / R-BT-4: Sharpe uses sqrt(periodsPerYear) of the REAL
 *    timeframe, never a fixed sqrt(252).
 *  - R-BT-5: embargo/purge between train and test windows.
 *  - R-BT-6: determinism — same input, same output, always.
 */

export type BacktestRunId = string;

export type EntryRule = 'open_next_bar';

export interface BacktestCosts {
  /** Fixed cost per trade (currency units), e.g. brokerage. */
  readonly fixedBrokerage: number;
  /** Percentage cost on notional, e.g. B3 emoluments (0.00325 = 0.325%). */
  readonly emolumentsPct: number;
  /** Half-spread cost applied against entry/exit price, in basis points. */
  readonly spreadBps: number;
  /** Slippage applied against entry/exit price, in basis points. */
  readonly slippageBps: number;
  /** Contract/lot size multiplying price deltas into P&L. */
  readonly lotSize: number;
}

export interface BacktestBar {
  readonly time: string;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  /** Point-in-time axis: this bar must never be used before knowledgeTime <= the bar it is being evaluated against (R-BT-7). */
  readonly knowledgeTime: string;
}

export interface BacktestSignalInput {
  readonly barTime: string;
  readonly direction: 'BUY' | 'SELL' | 'HOLD';
  readonly knowledgeTime: string;
  readonly stopPrice?: number | null;
  readonly takeProfitPrice?: number | null;
}

export type TradeExitReason = 'STOP' | 'TAKE_PROFIT' | 'WINDOW_END' | 'HORIZON_END';

export interface BacktestTrade {
  readonly signalBarTime: string;
  readonly entryTime: string;
  readonly entryPrice: number;
  readonly exitTime: string;
  readonly exitPrice: number;
  readonly direction: 'BUY' | 'SELL';
  readonly grossPnl: number;
  readonly costs: number;
  readonly netPnl: number;
  readonly netReturn: number;
  readonly exitReason: TradeExitReason;
}

export interface BacktestMetrics {
  readonly trades: number;
  readonly totalNetPnl: number;
  readonly totalNetReturn: number;
  readonly meanReturn: number;
  readonly stdDevReturn: number;
  readonly sharpe: number;
  readonly periodsPerYear: number;
  readonly maxDrawdown: number;
  readonly winRate: number;
}

export interface BacktestEngineInput {
  /** Ascending by time, already point-in-time filtered by the application layer. */
  readonly bars: readonly BacktestBar[];
  readonly signals: readonly BacktestSignalInput[];
  readonly costs: BacktestCosts;
  readonly periodsPerYear: number;
  readonly entryRule: EntryRule;
  /**
   * Item A / D8 (ML Híbrido — spec revisão 3): horizonte de PREVISÃO fixo,
   * contado a partir do SINAL (bar `t`), não da entrada (`t+1`). Um modelo
   * que prevê `close[t+10] > close[t]` precisa que a posição feche
   * exatamente em `t+10` (preço de saída = close dessa barra), não em
   * `entry + horizonte` (`t+11`) — esse era um off-by-one real corrigido
   * na revisão 3 da spec do Item A. Campo opcional: omitido preserva o
   * comportamento atual do motor (WINDOW_END/stop/TP), sem mudança para
   * nenhum consumidor existente.
   */
  readonly predictionHorizonBars?: number;
}

export interface BacktestEngineResult {
  readonly trades: readonly BacktestTrade[];
  readonly metrics: BacktestMetrics;
}

export class PointInTimeViolationError extends Error {}
export class LookaheadViolationError extends Error {}

function costForNotional(entryPrice: number, exitPrice: number, costs: BacktestCosts): number {
  const notional = (Math.abs(entryPrice) + Math.abs(exitPrice)) * costs.lotSize;
  const emoluments = notional * costs.emolumentsPct;
  const spreadCost = (entryPrice + exitPrice) * costs.lotSize * (costs.spreadBps / 10_000);
  const slippageCost = (entryPrice + exitPrice) * costs.lotSize * (costs.slippageBps / 10_000);
  return costs.fixedBrokerage + emoluments + spreadCost + slippageCost;
}

/**
 * Deterministic backtest engine — pure function, no I/O. Bars and
 * signals are assumed already loaded point-in-time by the caller
 * (application layer); this function defensively re-checks R-BT-1 and
 * R-BT-7 and throws rather than silently producing an unsound trade.
 */
export function runDeterministicBacktest(input: BacktestEngineInput): BacktestEngineResult {
  const bars = [...input.bars].sort((a, b) => compareInstants(parseInstant(a.time)!, parseInstant(b.time)!));
  const barIndexByTime = new Map<string, number>();
  bars.forEach((bar, index) => barIndexByTime.set(bar.time, index));

  const trades: BacktestTrade[] = [];

  for (const signal of input.signals) {
    if (signal.direction === 'HOLD') continue;

    const signalBarIndex = barIndexByTime.get(signal.barTime);
    if (signalBarIndex === undefined) continue; // signal bar not in the point-in-time window: skip, never fabricate.

    // R-BT-7: the engine must only ever see data whose knowledgeTime <= the bar's own time.
    if (compareInstants(parseInstant(signal.knowledgeTime)!, parseInstant(signal.barTime)!) > 0) {
      throw new PointInTimeViolationError(`signal knowledgeTime posterior a barTime: ${signal.barTime}`);
    }

    // R-BT-1 / CR-9: entry is always the NEXT bar's open — never bar[t] itself.
    const entryBarIndex = signalBarIndex + 1;
    const entryBar = bars[entryBarIndex];
    if (!entryBar) continue; // no next bar available in the window: no entry, not a lookahead workaround.
    if (!isStrictlyAfter(entryBar.time, signal.barTime)) {
      throw new LookaheadViolationError(`entryBar.time deve ser estritamente posterior a signal.barTime`);
    }
    if (compareInstants(parseInstant(entryBar.knowledgeTime)!, parseInstant(entryBar.time)!) > 0) {
      throw new PointInTimeViolationError(`entryBar knowledgeTime posterior à própria barra: ${entryBar.time}`);
    }

    const direction: 'BUY' | 'SELL' = signal.direction;
    const entryPrice = entryBar.open;

    // R-BT-2: walk forward evaluating stop/take-profit INTRABAR (high/low), never only at close.
    let exitBar = bars[bars.length - 1];
    let exitPrice = exitBar.close;
    let exitReason: TradeExitReason = 'WINDOW_END';

    // D8: exit-by-horizon is counted from the SIGNAL bar (t), not the entry
    // bar (t+1) — target[t+10] means the position must close AT t+10, not
    // t+11. `undefined` when the field is omitted preserves today's engine
    // behavior exactly (no horizon cutoff at all).
    const horizonBarIndex = input.predictionHorizonBars !== undefined ? signalBarIndex + input.predictionHorizonBars : undefined;

    for (let i = entryBarIndex; i < bars.length; i += 1) {
      const bar = bars[i];
      if (compareInstants(parseInstant(bar.knowledgeTime)!, parseInstant(bar.time)!) > 0) {
        throw new PointInTimeViolationError(`bar knowledgeTime posterior à própria barra: ${bar.time}`);
      }
      if (direction === 'BUY') {
        if (signal.stopPrice != null && bar.low <= signal.stopPrice) {
          exitBar = bar; exitPrice = signal.stopPrice; exitReason = 'STOP'; break;
        }
        if (signal.takeProfitPrice != null && bar.high >= signal.takeProfitPrice) {
          exitBar = bar; exitPrice = signal.takeProfitPrice; exitReason = 'TAKE_PROFIT'; break;
        }
      } else {
        if (signal.stopPrice != null && bar.high >= signal.stopPrice) {
          exitBar = bar; exitPrice = signal.stopPrice; exitReason = 'STOP'; break;
        }
        if (signal.takeProfitPrice != null && bar.low <= signal.takeProfitPrice) {
          exitBar = bar; exitPrice = signal.takeProfitPrice; exitReason = 'TAKE_PROFIT'; break;
        }
      }
      // Stop/TP checked above take priority even on the horizon bar itself.
      if (horizonBarIndex !== undefined && i === horizonBarIndex) {
        exitBar = bar; exitPrice = bar.close; exitReason = 'HORIZON_END'; break;
      }
    }

    // R-BT-3: real costs, always subtracted — never zero by omission.
    const costs = costForNotional(entryPrice, exitPrice, input.costs);
    const priceDelta = direction === 'BUY' ? exitPrice - entryPrice : entryPrice - exitPrice;
    const grossPnl = priceDelta * input.costs.lotSize;
    const netPnl = grossPnl - costs;
    const notionalBase = Math.abs(entryPrice) * input.costs.lotSize;
    const netReturn = notionalBase !== 0 ? netPnl / notionalBase : 0;

    trades.push(
      Object.freeze({
        signalBarTime: signal.barTime,
        entryTime: entryBar.time,
        entryPrice,
        exitTime: exitBar.time,
        exitPrice,
        direction,
        grossPnl,
        costs,
        netPnl,
        netReturn,
        exitReason,
      }),
    );
  }

  const metrics = computeMetrics(trades, input.periodsPerYear);
  return Object.freeze({ trades: Object.freeze(trades), metrics });
}

function computeMetrics(trades: readonly BacktestTrade[], periodsPerYear: number): BacktestMetrics {
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

/**
 * R-BT-5 (embargo/purge): discards test bars whose time falls within
 * `embargoDays` after `trainEnd`. Pure date arithmetic (UTC, calendar
 * days) — no I/O.
 */
export function applyEmbargo<T extends { readonly time: string }>(bars: readonly T[], trainEnd: string, embargoDays: number): readonly T[] {
  const trainEndInstant = parseInstant(trainEnd);
  if (trainEndInstant === null) throw new Error('trainEnd inválido');
  const embargoEndMs = trainEndInstant.milliseconds + embargoDays * 86_400_000;
  return Object.freeze(
    bars.filter((bar) => {
      const barInstant = parseInstant(bar.time);
      return barInstant !== null && barInstant.milliseconds >= embargoEndMs;
    }),
  );
}
