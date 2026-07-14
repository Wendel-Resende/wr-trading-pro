import type { BacktestRun as BacktestRunRow } from '@prisma/client';
import type { BacktestRunPersistedShape } from '../../../domain/v1/ports/backtest-repository';

export const toBacktestRun = (row: BacktestRunRow): BacktestRunPersistedShape => ({
  backtestId: row.backtestId,
  researchRunId: row.researchRunId,
  modelVersionId: row.modelVersionId,
  instrumentId: row.instrumentId,
  entryRule: row.entryRule,
  costsJson: row.costsJson,
  windowStart: row.windowStart.toISOString(),
  windowEnd: row.windowEnd.toISOString(),
  metricsJson: row.metricsJson,
  embargoDays: row.embargoDays,
  createdAt: row.createdAt.toISOString(),
});
