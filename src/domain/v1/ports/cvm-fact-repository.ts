import type { CvmFact, CvmScope, CvmStatementType } from '../models/cvm-fact';
import type { CvmPointInTimeView } from '../models/cvm-point-in-time-view';
import type { IssuerId } from '../models/issuer';

export interface CvmFactQuery {
  readonly issuerId: IssuerId;
  readonly statementType?: CvmStatementType;
  readonly scope?: CvmScope;
  readonly accountCode?: string;
  /** Inclusive lower bound on periodEnd. */
  readonly periodFrom?: string;
  /** Inclusive upper bound on periodEnd. */
  readonly periodTo?: string;
}

/**
 * Read-only, point-in-time access to CVM accounting facts. Visibility
 * mirrors CvmFilingRepository: the owning filing's `publishedAt` must be
 * `<= decisionTime` and the fact's `createdByRun` must be SUCCEEDED with
 * `completedAt <= knowledgeTime`.
 *
 * Results reflect the chain-effective filing selection: facts belonging
 * to a filing version that is superseded by an already-visible
 * restatement are excluded in favor of the restatement's facts for the
 * same (statementType, scope, accountCode, period) key, when both
 * filings are visible under the given view.
 */
export interface CvmFactRepository {
  findFacts(query: CvmFactQuery, view: CvmPointInTimeView): Promise<readonly CvmFact[]>;
}
