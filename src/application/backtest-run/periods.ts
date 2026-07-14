import type { Timeframe } from '../../domain/v1/models/market-bar';

/**
 * Periods-per-year map used by the Sharpe calculation (R-BT-4), keyed
 * by the REAL timeframe of the backtest — never a fixed sqrt(252).
 *
 * Convention (documented, financial-market standard for B3/most
 * venues): 252 trading days/year, ~6.5 trading hours/day (390 minutes).
 *  - '1d' -> 252 (one observation per trading day).
 *  - '1w' -> 52 (one observation per week).
 *  - '4h' -> 252 * (390/60/4) ≈ 252 * 1.625 = 409.5 four-hour bars/year.
 *  - '1h' -> 252 * (390/60) = 252 * 6.5 = 1638 one-hour bars/year.
 *  - '30m' -> 252 * (390/30) = 252 * 13 = 3276.
 *  - '15m' -> 252 * (390/15) = 252 * 26 = 6552.
 *  - '5m'  -> 252 * (390/5)  = 252 * 78 = 19656.
 *  - '1m'  -> 252 * 390 = 98280.
 */
export const PERIODS_PER_YEAR_BY_TIMEFRAME: Readonly<Record<Timeframe, number>> = Object.freeze({
  '1m': 252 * 390,
  '5m': 252 * (390 / 5),
  '15m': 252 * (390 / 15),
  '30m': 252 * (390 / 30),
  '1h': 252 * (390 / 60),
  '4h': 252 * (390 / 60 / 4),
  '1d': 252,
  '1w': 52,
});

export function periodsPerYearFor(timeframe: Timeframe): number {
  return PERIODS_PER_YEAR_BY_TIMEFRAME[timeframe];
}
