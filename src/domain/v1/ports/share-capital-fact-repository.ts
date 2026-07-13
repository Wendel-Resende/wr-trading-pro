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
}

/**
 * Read-only, point-in-time access to share capital facts. Visibility and
 * chain-effective selection mirror CvmFactRepository.
 */
export interface ShareCapitalFactRepository {
  findShareCapitalFacts(query: ShareCapitalFactQuery, view: CvmPointInTimeView): Promise<readonly ShareCapitalFact[]>;
}
