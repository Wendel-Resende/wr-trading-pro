import { ReadModelError } from '../../../../../application/read-models-v1';
import { isAdmin } from '../../../../../lib/auth/admin';
import type { MlTrainingRun } from '../../../../../domain/v1/models/ml-training-run';

/**
 * Bloqueador 12 (revisão Guardião): política explícita de autorização para
 * o recurso MlTrainingRun. Antes disto, `resolveRequestedBy` podia devolver
 * `'unknown'` (config/sessão ausente) e a rota seguia em frente tratando
 * esse principal como um usuário legítimo — nunca rejeitado. Fail-closed:
 * sem identidade resolvida, nenhuma ação (criar/listar/detalhar/cancelar) é
 * permitida.
 */
export function requireKnownPrincipal(requestedBy: string): string {
  if (requestedBy === 'unknown' || requestedBy.length === 0) {
    throw new ReadModelError('UNAUTHENTICATED', 'sessão inválida ou ausente — nenhuma identidade resolvida');
  }
  return requestedBy;
}

/**
 * Bloqueador 12: cancelamento só é permitido para o próprio autor do
 * treino (`run.requestedBy`) ou para um admin (`isAdmin`, allowlist
 * explícita — mesmo gate fail-closed já usado por `BacktestCostProfile`).
 * Um token de serviço/outro usuário nunca cancela o job de outra pessoa
 * "por acidente" — precisa estar na allowlist de admin, intencionalmente.
 */
export function requireCancelAuthorized(requestedBy: string, run: Pick<MlTrainingRun, 'requestedBy'>): void {
  if (run.requestedBy === requestedBy) return;
  if (isAdmin(requestedBy)) return;
  throw new ReadModelError('FORBIDDEN', 'apenas o autor do treino ou um admin pode cancelá-lo');
}
