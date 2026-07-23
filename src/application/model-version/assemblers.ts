import type { ModelVersion } from '../../domain/v1/models/model-version';
import type { ModelVersionReadModelV1 } from './dto';

export function assembleModelVersion(model: ModelVersion): ModelVersionReadModelV1 {
  return Object.freeze({
    modelVersion: model.modelVersion,
    kind: model.kind,
    label: model.label,
    asOf: model.asOf,
    hyperparametersJson: model.hyperparametersJson,
    trainingEvidenceJson: model.trainingEvidenceJson,
    invalidatedAt: model.invalidatedAt,
    invalidationReason: model.invalidationReason,
    publishedAt: model.publishedAt,
    createdAt: model.createdAt,
  });
}
