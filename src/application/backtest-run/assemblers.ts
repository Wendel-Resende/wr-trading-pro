import type { BacktestRunPersistedShape } from '../../domain/v1/ports/backtest-repository';
import type { BacktestRunReadModelV1 } from './dto';

/** Pure assembler: no I/O. Parses the persisted JSON blobs back into structured shapes for the wire response. */
export function assembleBacktestRun(model: BacktestRunPersistedShape): BacktestRunReadModelV1 {
  const parsedMetrics: { metrics: unknown; trades: unknown } = JSON.parse(model.metricsJson);
  return Object.freeze({
    backtestId: model.backtestId,
    researchRunId: model.researchRunId,
    modelVersionId: model.modelVersionId,
    instrumentId: model.instrumentId,
    entryRule: model.entryRule,
    costs: JSON.parse(model.costsJson),
    windowStart: model.windowStart,
    windowEnd: model.windowEnd,
    embargoDays: model.embargoDays,
    metrics: parsedMetrics.metrics,
    trades: parsedMetrics.trades,
    createdAt: model.createdAt,
  });
}
