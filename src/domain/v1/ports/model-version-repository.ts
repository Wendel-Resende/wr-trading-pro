import type { ModelVersion, ModelVersionKind, ModelVersionSubmission } from '../models/model-version';

export interface ModelVersionRepository {
  create(submission: ModelVersionSubmission): Promise<ModelVersion>;
  findById(modelVersion: string): Promise<ModelVersion | null>;
  findByKind(kind: ModelVersionKind): Promise<readonly ModelVersion[]>;
  /** Item B (bloqueador alto 3): leitura paginada/server-side para a rota pública — `findByKind` acima permanece só para uso interno (ex.: `predictLive`, que precisa varrer todas as candidatas). */
  listByKindPaginated(kind: ModelVersionKind, limit: number, cursor?: string): Promise<readonly ModelVersion[]>;
  invalidate(modelVersion: string, invalidatedAt: string, reason: string): Promise<ModelVersion>;
  /**
   * LOTE 2 (Item C): publica (ativa) uma ModelVersion DRAFT — nunca chamado
   * fora de um claim CAS atômico contra o `MlTrainingRun` dono do treino
   * (ver `worker.ts` `claimAndPublish`), exceto no fluxo síncrono legado
   * (`runTraining`, sem cancelamento possível) e em fixtures de teste.
   */
  publish(modelVersion: string, publishedAt: string): Promise<ModelVersion>;
}
