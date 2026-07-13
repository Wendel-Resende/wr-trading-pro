/**
 * Point-in-time read view for CVM filings/facts (Fase 2 / Item 2).
 *
 * Two independent axes:
 *  - `decisionTime`: the market-availability instant being simulated —
 *    a row is only visible when `filing.publishedAt <= decisionTime`.
 *  - `knowledgeTime`: the platform's system-time axis — a row is only
 *    visible when its `createdByRun` reached SUCCEEDED with
 *    `completedAt <= knowledgeTime`.
 *
 * Implementations MUST reject `knowledgeTime > decisionTime`: the
 * platform can never claim to have known something before it was even
 * publicly available to know.
 */
export interface CvmPointInTimeView {
  readonly decisionTime: string;
  readonly knowledgeTime: string;
}
