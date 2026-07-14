export interface BacktestRunPersistedShape {
  readonly backtestId: string;
  readonly researchRunId: string;
  readonly modelVersionId: string;
  readonly instrumentId: string;
  readonly entryRule: string;
  readonly costsJson: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly metricsJson: string;
  readonly embargoDays: number;
  readonly createdAt: string;
}

export interface BacktestRunSubmission {
  readonly researchRunId: string;
  readonly modelVersionId: string;
  readonly instrumentId: string;
  readonly entryRule: string;
  readonly costsJson: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly metricsJson: string;
  readonly embargoDays: number;
}

export interface BacktestRepository {
  create(submission: BacktestRunSubmission): Promise<BacktestRunPersistedShape>;
  findById(backtestId: string): Promise<BacktestRunPersistedShape | null>;
  findByModelVersion(modelVersionId: string): Promise<readonly BacktestRunPersistedShape[]>;
}
