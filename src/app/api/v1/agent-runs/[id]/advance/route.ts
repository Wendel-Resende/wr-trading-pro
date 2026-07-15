import { prisma } from '../../../../../../lib/prisma';
import { createAgentRunService } from '../../../../../../application/agent-run';
import { serverLlmAgentAdapter } from '../../../../../../adapters/llm/server-llm-agent';
import { jsonError, jsonSuccess } from '../../../_shared/http';

export const dynamic = 'force-dynamic';

/**
 * Processa um AgentRun QUEUED (QUEUED -> RUNNING -> SUCCEEDED/FAILED).
 *
 * Única rota que injeta a porta LLM real (proxy server-side com fallback
 * entre provedores): os nós AGENT/SYNTHESIS produzem análise de verdade e o
 * custo do orçamento passa a ser tokens. Sem provedor disponível, o runtime
 * cai para o caminho determinístico, sempre marcado como simulado nos
 * nodeStates. Propostas continuam sem autoridade de execução.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const service = createAgentRunService(prisma, { agentLlm: serverLlmAgentAdapter });
    const run = await service.advance(id);
    return jsonSuccess(run);
  } catch (error) {
    return jsonError(error);
  }
}
