import type { PrismaClient } from '@prisma/client';
import type { AgentLlmPort } from '../../domain/v1/ports/agent-llm';
import { PrismaAgentRunRepository } from '../../adapters/prisma/agent-run';
import { AgentRunService } from './service';

/**
 * `agentLlm` é opcional e deliberadamente NÃO é injetado por padrão: testes
 * e chamadas que não processam runs (submit/get/list/cancel) permanecem
 * determinísticos e sem dependência de rede. Apenas a rota de processamento
 * (/api/v1/agent-runs/[id]/advance) injeta o adapter LLM real.
 */
export function createAgentRunService(
  prisma: PrismaClient,
  options?: { readonly agentLlm?: AgentLlmPort }
): AgentRunService {
  return new AgentRunService({
    agentRunRepository: new PrismaAgentRunRepository(prisma),
    agentLlm: options?.agentLlm,
  });
}
