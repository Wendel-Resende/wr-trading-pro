import type { PrismaClient } from '@prisma/client';
import { createRiskPolicyService } from '../risk-policy/compose';
import { createOrderIntentService } from '../order-intent/compose';
import type { PilotExecutionPort } from '../../domain/v1/ports/pilot-execution';
import { McpTradeService, type MarketSnapshotPort } from './service';

/**
 * MCP Piloto — Task 6: wiring de produção do `McpTradeService`.
 * `execution`/`snapshot` são injetados pelo chamador (Task 7 fornece a
 * implementação real via bridge MT5); aqui só compõe os serviços já
 * existentes de risco/order-intent com o Prisma real.
 */
export function createMcpTradeService(
  prisma: PrismaClient,
  execution: PilotExecutionPort,
  snapshot: MarketSnapshotPort,
): McpTradeService {
  return new McpTradeService({
    prisma,
    riskPolicy: createRiskPolicyService(prisma),
    orderIntent: createOrderIntentService(prisma),
    execution,
    snapshot,
  });
}
