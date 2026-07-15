import { prisma } from '../../../../../../lib/prisma';
import { createAgentRunService } from '../../../../../../application/agent-run';
import { jsonError, jsonSuccess } from '../../../_shared/http';

export const dynamic = 'force-dynamic';

/**
 * Processa um AgentRun QUEUED (QUEUED -> RUNNING -> SUCCEEDED/FAILED).
 *
 * O runtime da Fase 3 expunha `advance()` apenas nos testes — nenhuma rota
 * ou worker o chamava, então runs criados via API ficavam QUEUED para
 * sempre. Esta rota é o elo que faltava para a UI: aditiva, delega ao
 * serviço existente sem alterá-lo (execução determinística simulada, sem
 * LLM real — ver spec da Fase 3).
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const service = createAgentRunService(prisma);
    const run = await service.advance(id);
    return jsonSuccess(run);
  } catch (error) {
    return jsonError(error);
  }
}
