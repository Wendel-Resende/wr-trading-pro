import type { BacktestCostProfile as BacktestCostProfileRow } from '@prisma/client';
import type { BacktestCostProfile } from '../../../domain/v1/models/backtest-cost-profile';

export const toBacktestCostProfile = (row: BacktestCostProfileRow): BacktestCostProfile => ({
  id: row.id,
  version: row.version,
  label: row.label,
  fixedBrokerage: row.fixedBrokerage,
  emolumentsPct: row.emolumentsPct,
  spreadBps: row.spreadBps,
  slippageBps: row.slippageBps,
  lotSize: row.lotSize,
  source: row.source,
  createdBy: row.createdBy,
  createdAt: row.createdAt.toISOString(),
  archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
  archivedBy: row.archivedBy,
});
