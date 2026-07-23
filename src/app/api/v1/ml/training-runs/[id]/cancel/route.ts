import { prisma } from '../../../../../../../lib/prisma';
import { createHttpMlTrainJobPort, createMlTrainingRunService, ensureReconciledOnce, toMlTrainingRunPublicDTO } from '../../../../../../../application/ml-training-run';
import { jsonError, jsonSuccess } from '../../../../_shared/http';
import { resolveRequestedBy } from '../../../../agent-runs/_requested-by';
import { requireCancelAuthorized, requireKnownPrincipal } from '../../_authz';

export const dynamic = 'force-dynamic';

function mlApiBaseUrl(): string {
  return process.env.WR_ML_API_URL ?? 'http://127.0.0.1:5560';
}

/**
 * Item C (spec §5/§7): idempotente — chamar de novo em `CANCEL_REQUESTED`
 * ou em estado terminal apenas devolve o estado atual (200), nunca erro.
 * Cancelamento REAL: se o job Python já foi iniciado (`pythonJobId`
 * conhecido), este handler já dispara `trainJobPort.cancel` aqui mesmo
 * (além do worker também tentar, de forma idempotente, no próximo poll) —
 * nunca depende só de abortar o `fetch` do Next.
 *
 * Bloqueador 4 (revisão Guardião): reconcilia antes de responder — um
 * cancelamento pedido logo após restart do Node precisa enxergar o estado
 * real do run/job, não um estado in-memory perdido no restart.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    await ensureReconciledOnce({ prisma, trainJobPort: createHttpMlTrainJobPort(mlApiBaseUrl()), mlApiBaseUrl: mlApiBaseUrl() });
    const requestedBy = requireKnownPrincipal(await resolveRequestedBy(request));
    const { id } = await params;
    const service = createMlTrainingRunService(prisma);
    // Bloqueador 12 (revisão Guardião): autorização checada ANTES do
    // cancelamento efetivo — apenas o autor do treino ou um admin
    // (allowlist explícita) pode cancelar. Nunca aceita um token de
    // serviço/outro usuário cancelando o job de outra pessoa "de graça".
    const existing = await service.get(id);
    requireCancelAuthorized(requestedBy, existing);
    const run = await service.requestCancel(id);

    if (run.status === 'CANCEL_REQUESTED' && run.pythonJobId) {
      const trainJobPort = createHttpMlTrainJobPort(mlApiBaseUrl());
      try {
        await trainJobPort.cancel(run.pythonJobId);
      } catch {
        // best-effort: o worker também tenta cancelar a cada poll; nunca
        // falha a resposta HTTP por causa disso.
      }
    }

    return jsonSuccess(toMlTrainingRunPublicDTO(run));
  } catch (error) {
    return jsonError(error);
  }
}
