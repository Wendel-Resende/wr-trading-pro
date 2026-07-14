export interface ResearchRunReadModelV1 {
  readonly runId: string;
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
