import { prisma } from '../../../../../lib/prisma';
import { createAgentRunService } from '../../../../../application/agent-run';
import { jsonError, jsonSuccess } from '../../_shared/http';

export const dynamic = 'force-dynamic';

/**
 * Reaper de runs órfãos: marca FAILED (ORPHANED_RUN) todo run RUNNING sem
 * progresso além do limiar do serviço — sobras de um processo que morreu no
 * meio do advance. QUEUED nunca é tocado. O limiar é exclusivamente
 * server-side (nenhum parâmetro do cliente é aceito) e a porta LLM não é
 * injetada: esta rota apenas transiciona estado, nunca executa nós.
 */
export async function POST(): Promise<Response> {
  try {
    const service = createAgentRunService(prisma);
    const reaped = await service.reapStaleRuns();
    return jsonSuccess({ reapedCount: reaped.length, reaped });
  } catch (error) {
    return jsonError(error);
  }
}
