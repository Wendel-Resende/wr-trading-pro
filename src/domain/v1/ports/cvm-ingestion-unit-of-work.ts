import type { CvmFactSubmission } from '../models/cvm-fact';
import type { CvmFilingSubmission } from '../models/cvm-filing';
import type { IngestionRunId, IngestionSourceKey } from '../models/ingestion';
import type { ShareCapitalFactSubmission } from '../models/share-capital-fact';

export interface CvmIngestionBatch {
  readonly filings: readonly CvmFilingSubmission[];
  readonly facts: readonly CvmFactSubmission[];
  readonly shareCapitalFacts: readonly ShareCapitalFactSubmission[];
}

/**
 * Mutation boundary for CVM filings/facts (Fase 2 / Item 2). Separate
 * from ReferenceDataIngestionUnitOfWork: nothing outside this port
 * writes CvmFiling/CvmFact/ShareCapitalFact rows.
 *
 * Lifecycle: `begin` opens exactly one RUNNING run. Exactly one of
 * `commit` or `fail` must be called afterwards, exactly once.
 *
 * `commit` MUST, in a single atomic transaction:
 *  1. validate the run is currently RUNNING and completedAt >= startedAt
 *     (fail closed otherwise);
 *  2. require every referenced issuer (by cvmCode) to already exist —
 *     this unit of work never creates an Issuer; unknown issuer fails
 *     closed with UnknownIssuerReferenceError;
 *  3. validate and write the filing batch: protocol+hash idempotent
 *     resubmission is a no-op, any divergence under the same protocol
 *     fails closed, first-version/restatement chain rules are enforced
 *     (predecessor required and not-already-superseded for
 *     restatements, versionNumber = predecessor + 1, same
 *     issuer/type/referenceDate), processed in canonical
 *     (issuerId, documentType, referenceDate, versionNumber) order —
 *     never raw input order;
 *  4. resolve each fact/share-capital submission's `filingCvmProtocol`
 *     against the batch or already-persisted filings; unresolved
 *     reference fails closed; the fact's issuer must equal the
 *     resolved filing's issuer;
 *  5. validate and write facts (INSTANT/DURATION period rules, signed
 *     64-bit valueRaw, exact-duplicate-in-batch fails closed) and
 *     share-capital facts (non-negative signed 64-bit quantity),
 *     processed in canonical order;
 *  6. transition the run to SUCCEEDED via compare-and-set.
 * Any error rolls back the entire transaction — no row (including the
 * run's own status) changes.
 *
 * `fail` transitions a RUNNING run straight to FAILED via
 * compare-and-set; it never touches filing/fact rows.
 *
 * Late/out-of-order restatements (referencing a predecessor that does
 * not yet exist) fail closed; there is no automatic reconciliation —
 * the caller must resubmit after the predecessor lands.
 */
export interface CvmIngestionUnitOfWork {
  begin(sourceKey: IngestionSourceKey, startedAt: string): Promise<IngestionRunId>;
  commit(runId: IngestionRunId, completedAt: string, summary: string, batch: CvmIngestionBatch): Promise<void>;
  fail(runId: IngestionRunId, completedAt: string, summary: string): Promise<void>;
}
