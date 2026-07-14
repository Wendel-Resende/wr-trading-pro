import type { ModelVersion, ModelVersionKind, ModelVersionSubmission } from '../models/model-version';

export interface ModelVersionRepository {
  create(submission: ModelVersionSubmission): Promise<ModelVersion>;
  findById(modelVersion: string): Promise<ModelVersion | null>;
  findByKind(kind: ModelVersionKind): Promise<readonly ModelVersion[]>;
  invalidate(modelVersion: string, invalidatedAt: string, reason: string): Promise<ModelVersion>;
}
