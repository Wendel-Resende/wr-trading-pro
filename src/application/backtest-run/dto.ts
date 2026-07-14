import type { BacktestBar, BacktestCosts, BacktestSignalInput, EntryRule } from '../../domain/v1/models/backtest-run';

export interface BacktestRunRequestV1 {
  readonly researchRunId: string;
  readonly modelVersionId: string;
  readonly instrumentId: string;
  readonly entryRule: EntryRule;
  readonly costs: BacktestCosts;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly embargoDays: number;
  /** Already point-in-time bars for the window (see deviation note: caller supplies these via the Phase 2 read-model routes). */
  readonly bars: readonly BacktestBar[];
  readonly signals: readonly BacktestSignalInput[];
}

export interface BacktestRunReadModelV1 {
  readonly backtestId: string;
  readonly researchRunId: string;
  readonly modelVersionId: string;
  readonly instrumentId: string;
  readonly entryRule: string;
  readonly costs: BacktestCosts;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly embargoDays: number;
  readonly metrics: unknown;
  readonly trades: unknown;
  readonly createdAt: string;
}
