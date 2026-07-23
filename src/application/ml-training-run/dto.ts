import type { MlTrainingRun } from '../../domain/v1/models/ml-training-run';

/**
 * Item C: DTO público allowlist — nunca `pythonJobId` (referência interna
 * de infraestrutura) nem `requestedBy` bruto além do necessário. Todo
 * conteúdo já foi validado/sanitizado na fronteira de persistência
 * (`adapters/prisma/ml-training-run/repository.ts`); aqui só filtramos os
 * campos permitidos.
 */
export interface MlTrainingRunPublicDTO {
  readonly trainingRunId: string;
  readonly status: MlTrainingRun['status'];
  readonly phase: MlTrainingRun['phase'];
  readonly progress: number;
  readonly costProfileId: string;
  readonly costProfileVersion: number;
  readonly symbols: readonly string[] | null;
  readonly researchRunId: string | null;
  readonly modelVersionId: string | null;
  readonly gate: MlTrainingRun['gate'];
  readonly metrics: MlTrainingRun['metrics'];
  readonly errorCode: string | null;
  readonly errorSummary: string | null;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly cancelRequestedAt: string | null;
}

export function toMlTrainingRunPublicDTO(run: MlTrainingRun): MlTrainingRunPublicDTO {
  return {
    trainingRunId: run.trainingRunId,
    status: run.status,
    phase: run.phase,
    progress: run.progress,
    costProfileId: run.costProfileId,
    costProfileVersion: run.costProfileVersion,
    symbols: run.symbols,
    researchRunId: run.researchRunId,
    modelVersionId: run.modelVersionId,
    gate: run.gate,
    metrics: run.metrics,
    errorCode: run.errorCode,
    errorSummary: run.errorSummary,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    cancelRequestedAt: run.cancelRequestedAt,
  };
}
