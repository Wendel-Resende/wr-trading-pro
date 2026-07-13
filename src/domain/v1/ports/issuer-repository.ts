import type { KnowledgeView } from '../models/ingestion';
import type { Issuer } from '../models/issuer';

/**
 * Read-only, as-known-at access to issuers. Implementations MUST only
 * return rows whose `createdByRun` reached SUCCEEDED with
 * `completedAt <= view.knowledgeTime`; rows created by a run that has
 * not (yet, from that vantage point) succeeded by that instant are
 * invisible, never partially visible.
 */
export interface IssuerRepository {
  getIssuerByCvmCode(cvmCode: string, view: KnowledgeView): Promise<Issuer | null>;
  findIssuers(view: KnowledgeView): Promise<readonly Issuer[]>;
}
