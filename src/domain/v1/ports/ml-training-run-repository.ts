import type {
  MlTrainingRun,
  MlTrainingRunGate,
  MlTrainingRunMetrics,
  MlTrainingRunPhase,
  MlTrainingRunStatus,
  MlTrainingRunSubmission,
} from '../models/ml-training-run';

export interface MlTrainingRunUpdate {
  readonly status?: MlTrainingRunStatus;
  readonly phase?: MlTrainingRunPhase;
  readonly progress?: number;
  readonly pythonJobId?: string | null;
  readonly researchRunId?: string | null;
  readonly modelVersionId?: string | null;
  readonly gate?: MlTrainingRunGate | null;
  readonly metrics?: MlTrainingRunMetrics | null;
  readonly errorCode?: string | null;
  readonly errorSummary?: string | null;
  readonly startedAt?: Date | null;
  readonly completedAt?: Date | null;
  readonly cancelRequestedAt?: Date | null;
}

export type CreateIfNoneActiveResult = { readonly outcome: 'CREATED'; readonly run: MlTrainingRun } | { readonly outcome: 'CONFLICT'; readonly run: MlTrainingRun };

export interface MlTrainingRunRepository {
  create(submission: MlTrainingRunSubmission): Promise<MlTrainingRun>;
  /** Atômico (transação única): impede dois treinos ativos concorrentes (spec §5) mesmo sob corrida real. */
  createIfNoneActive(submission: MlTrainingRunSubmission): Promise<CreateIfNoneActiveResult>;
  findById(trainingRunId: string): Promise<MlTrainingRun | null>;
  /** Único run "ativo" (QUEUED | RUNNING | CANCEL_REQUESTED) — usado para bloquear concorrência. */
  findActive(): Promise<MlTrainingRun | null>;
  /** Ordenado createdAt desc, id desc — determinístico, paginado por cursor opaco (trainingRunId). */
  list(limit: number, cursor?: string): Promise<readonly MlTrainingRun[]>;
  /** Aplica update via compare-and-swap na `status` atual esperada (evita corrida entre worker e cancelamento). */
  update(trainingRunId: string, expectedStatus: MlTrainingRunStatus, patch: MlTrainingRunUpdate): Promise<MlTrainingRun | null>;
  /**
   * Atômico contra QUEUED/RUNNING num único statement (nunca lê o status
   * antes para depois decidir o CAS — isso deixaria uma janela real de
   * corrida contra o worker, que também faz CAS QUEUED -> RUNNING ao mesmo
   * tempo). O WHERE é avaliado pelo próprio SQLite no momento da escrita,
   * não por um snapshot já obsoleto lido pela aplicação.
   */
  cancelIfActive(trainingRunId: string): Promise<MlTrainingRun | null>;
  /** Lista todos os runs não-terminais — usada só na reconciliação de boot. */
  listNonTerminal(): Promise<readonly MlTrainingRun[]>;
}
