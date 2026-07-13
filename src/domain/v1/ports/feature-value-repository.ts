import type { FeatureValue } from '../models/feature-value';

export interface FeatureValueQuery {
  readonly featureId?: string;
  readonly subjectId?: string;
  readonly decisionTime?: string;
  readonly knowledgeTime?: string;
  readonly from?: string;
  readonly to?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Read-only, point-in-time access to FeatureValue rows. No
 * update/delete/upsert method exists on this port — append-only by
 * construction at the TypeScript level.
 */
export interface FeatureValueRepository {
  findValues(query: FeatureValueQuery): Promise<readonly FeatureValue[]>;
}
