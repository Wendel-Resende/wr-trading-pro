/**
 * Item C (treino ML assíncrono, persistido e cancelável, 2026-07-22). Ver
 * docs/architecture/2026-07-22-item-c-async-ml-training.md e
 * `prisma/schema.prisma::MlTrainingRun`.
 */

export type MlTrainingRunStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'REJECTED'
  | 'FAILED'
  | 'CANCEL_REQUESTED'
  | 'CANCELLED'
  | 'INTERRUPTED';

export const ML_TRAINING_RUN_STATUSES: readonly MlTrainingRunStatus[] = Object.freeze([
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'REJECTED',
  'FAILED',
  'CANCEL_REQUESTED',
  'CANCELLED',
  'INTERRUPTED',
]);

/** Estados sem nenhuma transição de saída — nunca terminal -> não-terminal. */
export const TERMINAL_ML_TRAINING_RUN_STATUSES: ReadonlySet<MlTrainingRunStatus> = new Set([
  'SUCCEEDED',
  'REJECTED',
  'FAILED',
  'CANCELLED',
  'INTERRUPTED',
]);

/**
 * Item D: `BACKTESTS` foi REMOVIDA em 2026-07-25. Ela existia para a fase de
 * backtests por instrumento do motor híbrido; o motor direcional avalia
 * economia dentro de `GATE` (excesso por quintil líquido de custos), então a
 * fase nunca mais seria atingida e mentiria no acompanhamento do treino.
 */
export type MlTrainingRunPhase = 'QUEUED' | 'SNAPSHOT' | 'DATASET' | 'TRAINING' | 'GATE' | 'FINALIZING';

export const ML_TRAINING_RUN_PHASES: readonly MlTrainingRunPhase[] = Object.freeze([
  'QUEUED',
  'SNAPSHOT',
  'DATASET',
  'TRAINING',
  'GATE',
  'FINALIZING',
]);

/**
 * Item D: allowlist dos códigos de gate do classificador direcional — mesma
 * disciplina do allowlist anterior (nomes de baseline do motor híbrido):
 * qualquer código fora desta lista é descartado na leitura, nunca repassado
 * como texto livre vindo de um blob persistido.
 */
export const KNOWN_GATE_CHECK_CODES: ReadonlySet<string> = new Set([
  'ACCURACY_BELOW_MIN',
  'BRIER_ABOVE_MAX',
  'COVERAGE_BELOW_MIN',
  'BASELINE_DELTA_BELOW_MIN',
]);

export interface MlTrainingRunGateCheck {
  readonly code: string;
  readonly label: string;
  readonly threshold: number;
  /** `null` quando a métrica não existe (ex.: nenhum sinal de alta confiança). */
  readonly observed: number | null;
  readonly passed: boolean;
}

export interface MlTrainingRunGate {
  readonly approved: boolean;
  readonly checks: readonly MlTrainingRunGateCheck[];
}

/**
 * Resumo das métricas do treino direcional exibido no acompanhamento do run.
 * É deliberadamente um subconjunto: as métricas completas (matriz de confusão,
 * confiabilidade, por fold) vivem em `DirectionalModelVersion.metrics`.
 */
export interface MlTrainingRunMetrics {
  readonly nSamples: number;
  readonly nHighConfidence: number;
  readonly accuracy: number | null;
  readonly brier: number;
  readonly coverage: number;
  readonly baselineDelta: number | null;
}

export interface MlTrainingRun {
  readonly trainingRunId: string;
  readonly requestedBy: string;
  readonly costProfileId: string;
  readonly costProfileVersion: number;
  readonly symbols: readonly string[] | null;
  readonly status: MlTrainingRunStatus;
  readonly phase: MlTrainingRunPhase;
  readonly progress: number;
  readonly pythonJobId: string | null;
  readonly researchRunId: string | null;
  readonly modelVersionId: string | null;
  readonly gate: MlTrainingRunGate | null;
  readonly metrics: MlTrainingRunMetrics | null;
  readonly errorCode: string | null;
  readonly errorSummary: string | null;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly cancelRequestedAt: string | null;
}

export interface MlTrainingRunSubmission {
  readonly requestedBy: string;
  readonly costProfileId: string;
  readonly costProfileVersion: number;
  readonly symbols: readonly string[] | null;
}
