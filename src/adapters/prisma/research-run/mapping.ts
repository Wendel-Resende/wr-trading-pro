import type { ResearchRun as ResearchRunRow } from '@prisma/client';
import type { ResearchRun } from '../../../domain/v1/models/research-run';

export const toResearchRun = (row: ResearchRunRow): ResearchRun => ({
  runId: row.runId,
  name: row.name,
  hypothesis: row.hypothesis,
  datasetId: row.datasetId,
  windowStart: row.windowStart.toISOString(),
  windowEnd: row.windowEnd.toISOString(),
  paramsJson: row.paramsJson,
  createdBy: row.createdBy,
  createdAt: row.createdAt.toISOString(),
  modelVersionId: row.modelVersionId,
});
