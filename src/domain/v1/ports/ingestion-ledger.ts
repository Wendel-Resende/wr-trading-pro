import type { IngestionRun, IngestionRunId, IngestionRunStatus, IngestionSourceKey } from '../models/ingestion';

export interface IngestionRunQuery {
  readonly sourceKey?: IngestionSourceKey;
  readonly status?: IngestionRunStatus;
}

/** Read-only access to the ingestion run ledger. Mutations go through ReferenceDataIngestionUnitOfWork. */
export interface IngestionLedger {
  getRun(id: IngestionRunId): Promise<IngestionRun | null>;
  findRuns(query?: IngestionRunQuery): Promise<readonly IngestionRun[]>;
}
