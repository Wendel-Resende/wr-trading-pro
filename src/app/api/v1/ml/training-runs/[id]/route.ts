import { prisma } from '../../../../../../lib/prisma';
import { createHttpMlTrainJobPort, createMlTrainingRunService, ensureReconciledOnce, toMlTrainingRunPublicDTO } from '../../../../../../application/ml-training-run';
import { jsonError, jsonSuccess } from '../../../_shared/http';
import { resolveRequestedBy } from '../../../agent-runs/_requested-by';
import { requireKnownPrincipal } from '../_authz';

export const dynamic = 'force-dynamic';

function mlApiBaseUrl(): string {
  return process.env.WR_ML_API_URL ?? 'http://127.0.0.1:5560';
}

/**
 * Item C (spec §7): detalhe allowlist do treino — usado pela UI para
 * hidratar status/fase/progresso/gate/erro após reload, sem depender de
 * `useState`/`localStorage` (spec §5/§8).
 *
 * Bloqueador 4 (revisão Guardião): reconcilia antes de responder — sem
 * isso, um simples reload logo após um restart do Node poderia exibir
 * `RUNNING` para sempre (só `POST /training-runs` reconciliava antes).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    await ensureReconciledOnce({ prisma, trainJobPort: createHttpMlTrainJobPort(mlApiBaseUrl()), mlApiBaseUrl: mlApiBaseUrl() });
    requireKnownPrincipal(await resolveRequestedBy(request));
    const { id } = await params;
    const service = createMlTrainingRunService(prisma);
    const run = await service.get(id);
    return jsonSuccess(toMlTrainingRunPublicDTO(run));
  } catch (error) {
    return jsonError(error);
  }
}
