import type { IngestionRunId, IngestionSourceKey } from '../models/ingestion';
import type { VersionedMarketBarSubmission } from '../models/versioned-market-bar';

export interface MarketBarIngestionBatch {
  readonly bars: readonly VersionedMarketBarSubmission[];
}

/**
 * Mutation boundary for versioned market bars (Fase 2 / Item 3). This is
 * the only write path into VersionedMarketBar rows.
 *
 * Lifecycle: `begin` opens exactly one RUNNING run. Exactly one of
 * `commit` or `fail` must be called afterwards, exactly once.
 *
 * `commit` MUST, in a single atomic transaction:
 *  1. validate the run is currently RUNNING and completedAt >= startedAt
 *     (fail closed otherwise);
 *  2. derive `sourceKey` from the run itself — submissions never carry
 *     a sourceKey, and this unit of work never merges/chooses across
 *     sources implicitly;
 *  3. require every referenced InstrumentVersion to already exist (this
 *     unit of work NEVER creates an InstrumentVersion) and to be known,
 *     point-in-time, at this run's completedAt: the run that created the
 *     InstrumentVersion must be SUCCEEDED with completedAt <= this run's
 *     completedAt, and the bar's openedAt must fall inside the
 *     InstrumentVersion's known business-time interval
 *     [validFrom, validTo) as of this run's completedAt (respecting
 *     closedByRun visibility);
 *  4. enforce the SQX naming rule: if the derived sourceKey starts with
 *     `sqx`, the referenced InstrumentVersion.symbol must start with
 *     `WIN` or `WDO`, otherwise fail closed — this generic persistence
 *     layer never chooses a source on its own;
 *  5. validate and write the bar batch: exact-duplicate-in-batch
 *     `sourceRecordKey` fails closed even if identical; a resubmission of
 *     an already-persisted `sourceRecordKey` with byte-identical content
 *     is a no-op; any divergence fails closed; a new root for an already
 *     existing chain fails closed; a revision requires
 *     `isRevision=true` and a resolvable predecessor (in-batch or
 *     persisted) sharing sourceKey/instrumentVersionId/timeframe/openedAt,
 *     with `revisionNumber = predecessor.revisionNumber + 1`,
 *     `sourceAvailableAt` strictly after the predecessor's, and this
 *     run's `completedAt` strictly after the predecessor's creating run's
 *     `completedAt`; processed in canonical, deterministic topological
 *     order (root before revision) — never raw input order — with cycle
 *     detection;
 *  6. transition the run to SUCCEEDED via compare-and-set.
 * Any error rolls back the entire transaction — no row (including the
 * run's own status) changes. Adapter-level unique-constraint violations
 * are always caught and converted into typed domain errors; no
 * persistence-layer exception type ever leaks across this boundary.
 *
 * `fail` transitions a RUNNING run straight to FAILED via
 * compare-and-set; it never touches bar rows.
 */
export interface MarketBarIngestionUnitOfWork {
  begin(sourceKey: IngestionSourceKey, startedAt: string): Promise<IngestionRunId>;
  commit(runId: IngestionRunId, completedAt: string, summary: string, batch: MarketBarIngestionBatch): Promise<void>;
  fail(runId: IngestionRunId, completedAt: string, summary: string): Promise<void>;
}
