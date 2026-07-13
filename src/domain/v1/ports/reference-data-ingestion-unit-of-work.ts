import type { IngestionRunId, IngestionSourceKey } from '../models/ingestion';
import type { InstrumentVersionInput } from '../models/instrument-version';
import type { IssuerRegistration } from '../models/issuer';

export interface ReferenceDataBatch {
  readonly issuers: readonly IssuerRegistration[];
  readonly instrumentVersions: readonly InstrumentVersionInput[];
}

/**
 * Mutation boundary for the reference-data foundation (Issuer +
 * InstrumentVersion + IngestionRun). Kept separate from the read
 * repositories: nothing outside this port may write these tables.
 *
 * Lifecycle: `begin` opens exactly one RUNNING run. Exactly one of
 * `commit` or `fail` must be called afterwards, exactly once. Both
 * reject a `completedAt` strictly earlier than the run's own
 * `startedAt` (impossible chronology fails closed, same as any other
 * invariant violation — no partial write).
 *
 * `summary` is a JSON-serialized string (bounded length, must parse as
 * valid JSON); it is not accepted as arbitrary free text.
 *
 * `commit` MUST, in a single atomic transaction:
 *  1. validate the run is currently RUNNING and completedAt >= startedAt
 *     (fail closed otherwise);
 *  2. validate and write the complete issuer batch (fail-closed on
 *     conflicting identity for an existing cvmCode; idempotent no-op
 *     when the registration exactly matches an existing issuer);
 *  3. validate and write the complete instrument batch, processed in a
 *     canonical (symbol, exchange, validFrom) order — never the raw
 *     input array order — so a batch's outcome cannot depend on how the
 *     caller happened to list multiple versions of the same instrument;
 *     close any prior open interval for a (symbol, exchange) exactly at
 *     the new version's validFrom, then insert the new open version;
 *     reject duplicates, overlaps, more-than-one-open, and unknown
 *     issuer references;
 *  4. transition the run to SUCCEEDED with `completedAt` and `summary`.
 * If any step fails, the entire transaction rolls back and no
 * reference-data row (including the run's own status) changes.
 *
 * `fail` transitions a RUNNING run straight to FAILED with
 * `completedAt`/`summary`; it never touches issuer/instrument rows.
 */
export interface ReferenceDataIngestionUnitOfWork {
  begin(sourceKey: IngestionSourceKey, startedAt: string): Promise<IngestionRunId>;
  commit(runId: IngestionRunId, completedAt: string, summary: string, batch: ReferenceDataBatch): Promise<void>;
  fail(runId: IngestionRunId, completedAt: string, summary: string): Promise<void>;
}
