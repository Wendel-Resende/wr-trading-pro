import type {
  DirectionalModelStatus,
  DirectionalModelVersion,
  DirectionalModelVersionSubmission,
  DirectionalPrediction,
  DirectionalPredictionSubmission,
} from '../models/ml-directional';

/**
 * Item D — porta de persistência do classificador direcional.
 *
 * Escrita é append-only exceto por `supersede`, a única transição de estado
 * permitida (ACTIVE → SUPERSEDED). Um modelo FAILED nunca muda de status:
 * reprovado no gate é reprovado para sempre, e fica no banco só como
 * auditoria do que foi tentado.
 */
export interface DirectionalRepository {
  createModelVersion(submission: DirectionalModelVersionSubmission): Promise<DirectionalModelVersion>;
  findModelVersionById(modelVersion: string): Promise<DirectionalModelVersion | null>;
  /** Lista por status, mais recentes primeiro; sem filtro = todos os status. */
  listModelVersions(params: {
    readonly status?: DirectionalModelStatus;
    readonly limit: number;
    readonly cursor?: string;
  }): Promise<readonly DirectionalModelVersion[]>;
  /** Marca como SUPERSEDED todas as versões ACTIVE exceto `keepModelVersion`. Retorna quantas mudaram. */
  supersedeOthers(keepModelVersion: string): Promise<number>;
  /**
   * DRAFT → ACTIVE. Só é chamado DEPOIS de um claim CAS bem-sucedido contra o
   * `MlTrainingRun` dono do treino (ou no fluxo síncrono, que não é
   * cancelável). Publicar uma versão que não está DRAFT é erro de programação
   * e falha explicitamente.
   */
  publish(modelVersion: string): Promise<DirectionalModelVersion>;

  /**
   * Persiste um lote de previsões de uma mesma geração, atomicamente.
   * Idempotente pela chave única (modelVersion, cdCvm, generatedAt): reenviar
   * o MESMO lote não duplica linha nem falha. Retorna quantas previsões o lote
   * deixou persistidas (criadas + já existentes), não quantas foram inseridas.
   */
  savePredictions(submissions: readonly DirectionalPredictionSubmission[]): Promise<number>;
  /** Previsões da geração mais recente daquela versão de modelo. */
  listLatestPredictions(modelVersion: string): Promise<readonly DirectionalPrediction[]>;
}
