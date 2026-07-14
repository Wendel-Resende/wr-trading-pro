import type { ResearchRun } from '../../domain/v1/models/research-run';
import type { ResearchRunReadModelV1 } from './dto';

/** Pure assembler: no I/O. */
export function assembleResearchRun(model: ResearchRun): ResearchRunReadModelV1 {
  return Object.freeze({
    runId: model.runId,
    name: model.name,
    hypothesis: model.hypothesis,
    datasetId: model.datasetId,
    windowStart: model.windowStart,
    windowEnd: model.windowEnd,
    paramsJson: model.paramsJson,
    createdBy: model.createdBy,
    createdAt: model.createdAt,
    modelVersionId: model.modelVersionId,
  });
}
