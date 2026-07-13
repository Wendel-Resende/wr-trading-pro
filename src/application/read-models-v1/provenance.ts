import type { IngestionLedger } from '../../domain/v1/ports/ingestion-ledger';
import type { RunProvenanceDTO } from './dto';
import { ReadModelError } from './errors';

/**
 * Resolves `RunProvenanceDTO` for a `createdByRunId`, requiring the run to
 * be SUCCEEDED with a non-null `completedAt`. Any inconsistency (missing
 * run, wrong status, null completedAt) is a data-integrity bug in the
 * canonical foundation, never a client input error — it always surfaces
 * as a sanitized INTERNAL_ERROR, never leaking internals.
 *
 * A per-request cache avoids N+1 ledger lookups when many rows share the
 * same creating run (the common case).
 */
export class ProvenanceResolver {
  private readonly cache = new Map<string, RunProvenanceDTO>();

  constructor(private readonly ledger: IngestionLedger) {}

  async resolve(createdByRunId: string): Promise<RunProvenanceDTO> {
    const cached = this.cache.get(createdByRunId);
    if (cached) return cached;

    const run = await this.ledger.getRun(createdByRunId);
    if (!run || run.status !== 'SUCCEEDED' || run.completedAt === null) {
      throw new ReadModelError('INTERNAL_ERROR', 'inconsistência de proveniência ao resolver a run de origem');
    }

    const provenance: RunProvenanceDTO = Object.freeze({
      runId: run.id,
      sourceKey: run.sourceKey,
      completedAt: run.completedAt,
    });
    this.cache.set(createdByRunId, provenance);
    return provenance;
  }
}
