import type { CvmDocumentType } from '../models/cvm-filing';
import type { CvmPointInTimeView } from '../models/cvm-point-in-time-view';
import type { IssuerId } from '../models/issuer';
import type { ShareCapitalFact, ShareQuantityType } from '../models/share-capital-fact';

export interface ShareCapitalFactQuery {
  readonly issuerId: IssuerId;
  readonly shareClass?: string;
  readonly quantityType?: ShareQuantityType;
  /** Inclusive lower bound on periodEnd. */
  readonly periodFrom?: string;
  /** Inclusive upper bound on periodEnd. */
  readonly periodTo?: string;
  /**
   * Additive (Fase 2 / Item 4): see CvmFactQuery.documentType/referenceDate.
   * Both must be provided together, or both omitted.
   */
  readonly documentType?: CvmDocumentType;
  readonly referenceDate?: string;
  /** Additive (Fase 2 / Item 4): deterministic pagination. Omitted = unpaginated (legacy behavior). */
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Read-only, point-in-time access to share capital facts. Visibility and
 * chain-effective selection mirror CvmFactRepository.
 */
export interface ShareCapitalFactRepository {
  findShareCapitalFacts(query: ShareCapitalFactQuery, view: CvmPointInTimeView): Promise<readonly ShareCapitalFact[]>;
}
