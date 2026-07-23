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

export type MlTrainingRunPhase = 'QUEUED' | 'SNAPSHOT' | 'DATASET' | 'TRAINING' | 'GATE' | 'BACKTESTS' | 'FINALIZING';

export const ML_TRAINING_RUN_PHASES: readonly MlTrainingRunPhase[] = Object.freeze([
  'QUEUED',
  'SNAPSHOT',
  'DATASET',
  'TRAINING',
  'GATE',
  'BACKTESTS',
  'FINALIZING',
]);

export const KNOWN_GATE_BASELINE_NAMES: ReadonlySet<string> = new Set(['alwaysUp', 'timesfmOnly', 'fundamentalOnly', 'priceOnlyLgbm']);

export interface MlTrainingRunGateComparison {
  readonly baseline: string;
  readonly accuracyDiff: number;
  readonly ciLower: number;
  readonly passed: boolean;
}

export interface MlTrainingRunGate {
  readonly approved: boolean;
  readonly comparisons: readonly MlTrainingRunGateComparison[];
}

export interface MlTrainingRunMetrics {
  readonly nSamples: number;
  readonly accuracy: number;
  readonly baselines: {
    readonly alwaysUp: number;
    readonly timesfmOnly: number;
    readonly fundamentalOnly: number;
    readonly priceOnlyLgbm: number;
  };
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
