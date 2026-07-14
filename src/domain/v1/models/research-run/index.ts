import { compareInstants, parseInstant } from '../../time';

/**
 * ResearchRun (Fase 5 / Item 1): one research/experiment execution
 * (dataset, window, hyperparameters) with full provenance. `hypothesis`
 * is free text, possibly authored via an LLM — it is provenance only,
 * never a trade decision or execution primitive.
 */

export type ResearchRunId = string;

export interface ResearchRun {
  readonly runId: ResearchRunId;
  readonly name: string;
  readonly hypothesis: string;
  readonly datasetId: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly paramsJson: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly modelVersionId: string | null;
}

export interface ResearchRunSubmission {
  readonly name: string;
  readonly hypothesis: string;
  readonly datasetId: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly paramsJson: string;
  readonly modelVersionId?: string | null;
}

/** Pure rule: windowStart must be strictly before windowEnd. No I/O, no clock reads. */
export function isValidResearchWindow(windowStart: string, windowEnd: string): boolean {
  const start = parseInstant(windowStart);
  const end = parseInstant(windowEnd);
  if (start === null || end === null) return false;
  return compareInstants(start, end) < 0;
}
