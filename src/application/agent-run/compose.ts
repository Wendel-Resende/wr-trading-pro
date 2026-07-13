import type { PrismaClient } from '@prisma/client';
import { PrismaAgentRunRepository } from '../../adapters/prisma/agent-run';
import { AgentRunService } from './service';

export function createAgentRunService(prisma: PrismaClient): AgentRunService {
  return new AgentRunService({
    agentRunRepository: new PrismaAgentRunRepository(prisma),
  });
}
