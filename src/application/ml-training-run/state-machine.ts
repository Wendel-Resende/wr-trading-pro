import type { MlTrainingRunStatus } from '../../domain/v1/models/ml-training-run';
import { TERMINAL_ML_TRAINING_RUN_STATUSES } from '../../domain/v1/models/ml-training-run';

/**
 * Item C: máquina de estados explícita, única fonte de verdade sobre quais
 * transições são permitidas. Nenhum caminho do serviço/worker escreve
 * `status` fora daqui — terminal nunca volta a não-terminal (spec §4).
 * `CANCEL_REQUESTED` sempre termina em `CANCELLED`: mesmo que o Python
 * retorne um resultado aprovado depois do pedido de cancelamento, a
 * publicação (ModelVersion) nunca acontece (spec §5) — o worker descarta o
 * resultado e força `CANCELLED`.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<MlTrainingRunStatus, ReadonlySet<MlTrainingRunStatus>>> = {
  QUEUED: new Set(['RUNNING', 'CANCEL_REQUESTED', 'INTERRUPTED', 'FAILED']),
  RUNNING: new Set(['SUCCEEDED', 'REJECTED', 'FAILED', 'CANCEL_REQUESTED', 'INTERRUPTED']),
  CANCEL_REQUESTED: new Set(['CANCELLED', 'INTERRUPTED']),
  SUCCEEDED: new Set([]),
  REJECTED: new Set([]),
  FAILED: new Set([]),
  CANCELLED: new Set([]),
  INTERRUPTED: new Set([]),
};

export function isTerminalStatus(status: MlTrainingRunStatus): boolean {
  return TERMINAL_ML_TRAINING_RUN_STATUSES.has(status);
}

export function canTransition(from: MlTrainingRunStatus, to: MlTrainingRunStatus): boolean {
  return ALLOWED_TRANSITIONS[from].has(to);
}

/** Estados nos quais um pedido de cancelamento é aceito. */
export function isCancelable(status: MlTrainingRunStatus): boolean {
  return status === 'QUEUED' || status === 'RUNNING';
}
