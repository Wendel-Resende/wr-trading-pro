import type { CvmDocumentType, CvmFiling } from '../models/cvm-filing';
import type { CvmPointInTimeView } from '../models/cvm-point-in-time-view';
import type { IssuerId } from '../models/issuer';

/**
 * Read-only, point-in-time access to CVM filings. Implementations MUST
 * only return rows where `filing.publishedAt <= view.decisionTime` AND
 * `createdByRun.status === 'SUCCEEDED'` AND
 * `createdByRun.completedAt <= view.knowledgeTime`.
 *
 * The chain-effective selection returns, per (issuer, documentType,
 * referenceDate) chain, the highest `versionNumber` visible under the
 * given view — never simultaneously surfacing a superseded version and
 * its supersedeing restatement once both are visible. A restatement not
 * yet visible in the view never suppresses its predecessor.
 */
export interface CvmFilingRepository {
  getFilingByCvmProtocol(cvmProtocol: string, view: CvmPointInTimeView): Promise<CvmFiling | null>;

  /** All knowledge/decision-visible versions in the (issuer, documentType, referenceDate) chain, in versionNumber order. */
  findFilingChain(
    issuerId: IssuerId,
    documentType: CvmDocumentType,
    referenceDate: string,
    view: CvmPointInTimeView,
  ): Promise<readonly CvmFiling[]>;

  /** The chain-effective (highest visible versionNumber) filing, or null if the chain is not visible at all under this view. */
  findEffectiveFiling(
    issuerId: IssuerId,
    documentType: CvmDocumentType,
    referenceDate: string,
    view: CvmPointInTimeView,
  ): Promise<CvmFiling | null>;
}
