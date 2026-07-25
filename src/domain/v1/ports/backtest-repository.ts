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
  // Item A (revisão 4, D10) — nullable: BacktestRun legado/genérico nunca teve
  // esses campos preenchidos; só o fluxo ML Híbrido os grava.
  readonly costProfileId: string | null;
  readonly costProfileVersion: number | null;
  readonly predictionHorizonBars: number | null;
  readonly exitRuleKey: string | null;
  readonly idempotencyKey: string | null;
  readonly metricsSchemaVersion: number | null;
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
  // Item A (revisão 4, D10) — opcionais: ausentes na submissão genérica,
  // sempre presentes na submissão idempotente do ML Híbrido (ver
  // GovernedBacktestRunRequestV1 em application/backtest-run/dto.ts).
  readonly costProfileId?: string;
  readonly costProfileVersion?: number;
  readonly predictionHorizonBars?: number;
  readonly exitRuleKey?: string;
  readonly idempotencyKey?: string;
  readonly metricsSchemaVersion?: number;
}

export interface BacktestRepository {
  create(submission: BacktestRunSubmission): Promise<BacktestRunPersistedShape>;
  findById(backtestId: string): Promise<BacktestRunPersistedShape | null>;
  findByModelVersion(modelVersionId: string, limit?: number, cursor?: string): Promise<readonly BacktestRunPersistedShape[]>;
  /** Item A (D10) — base da idempotência: nunca cria uma segunda linha para a mesma chave. */
  findByIdempotencyKey(idempotencyKey: string): Promise<BacktestRunPersistedShape | null>;
}
