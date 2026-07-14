import type { ModelVersion as ModelVersionRow } from '@prisma/client';
import type { ModelVersion, ModelVersionKind } from '../../../domain/v1/models/model-version';

export const toModelVersion = (row: ModelVersionRow): ModelVersion => ({
  modelVersion: row.modelVersion,
  kind: row.kind as ModelVersionKind,
  label: row.label,
  asOf: row.asOf.toISOString(),
  hyperparametersJson: row.hyperparametersJson,
  trainingEvidenceJson: row.trainingEvidenceJson,
  invalidatedAt: row.invalidatedAt ? row.invalidatedAt.toISOString() : null,
  invalidationReason: row.invalidationReason,
  createdAt: row.createdAt.toISOString(),
});
