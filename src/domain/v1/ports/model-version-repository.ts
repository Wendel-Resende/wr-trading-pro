import type { ModelVersion, ModelVersionKind, ModelVersionSubmission } from '../models/model-version';

export interface ModelVersionRepository {
  create(submission: ModelVersionSubmission): Promise<ModelVersion>;
  findById(modelVersion: string): Promise<ModelVersion | null>;
  findByKind(kind: ModelVersionKind): Promise<readonly ModelVersion[]>;
  /** Item B (bloqueador alto 3): leitura paginada/server-side para a rota pública — `findByKind` acima permanece só para uso interno (ex.: `predictLive`, que precisa varrer todas as candidatas). */
  listByKindPaginated(kind: ModelVersionKind, limit: number, cursor?: string): Promise<readonly ModelVersion[]>;
  invalidate(modelVersion: string, invalidatedAt: string, reason: string): Promise<ModelVersion>;
}
