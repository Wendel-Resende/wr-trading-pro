import type { ResearchRun, ResearchRunSubmission } from '../models/research-run';

export interface ResearchRunRepository {
  create(submission: ResearchRunSubmission, createdBy: string): Promise<ResearchRun>;
  findById(runId: string): Promise<ResearchRun | null>;
  findByDataset(datasetId: string, limit?: number, cursor?: string): Promise<readonly ResearchRun[]>;
  findByModelVersion(modelVersionId: string, limit: number, cursor?: string): Promise<readonly ResearchRun[]>;
  /** Bloqueador 2 (revisão Guardião): liga o ResearchRun já criado à ModelVersion
   *  aprovada gerada pelo mesmo `runTraining` — nunca fica implícito. */
  linkModelVersion(runId: string, modelVersionId: string): Promise<ResearchRun>;
  /** Bloqueador 2: permite à UI mostrar a última pesquisa/reprovação do
   *  híbrido por nome, sem depender de uma versão ativa existir. */
  findRecentByName(name: string, limit: number, cursor?: string): Promise<readonly ResearchRun[]>;
}
