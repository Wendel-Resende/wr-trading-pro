import type { BacktestCostProfile, BacktestCostProfileSubmission } from '../models/backtest-cost-profile';

export interface BacktestCostProfileRepository {
  create(submission: BacktestCostProfileSubmission): Promise<BacktestCostProfile>;
  findById(id: string): Promise<BacktestCostProfile | null>;
  archive(id: string, archivedAt: string, archivedBy: string): Promise<BacktestCostProfile>;
  listActive(limit: number, cursor?: string): Promise<BacktestCostProfile[]>;
}
