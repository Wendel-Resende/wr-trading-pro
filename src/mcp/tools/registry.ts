/**
 * Catálogo agregado de tools read-only (Fase 4, seção 4). Cada builder
 * recebe a facade `McpReadServices` — nunca um `PrismaClient` cru — e
 * retorna definições determinísticas e idempotentes (leitura).
 */
import type { McpReadServices } from '../ports/mcp-read-service';
import { buildCvmTools } from './cvm';
import { buildMarketTools } from './market';
import { buildReconciliationTools } from './reconciliation';
import { buildRuntimeTools } from './runtime';
import type { McpToolDefinition } from './registry-types';

export function buildToolRegistry(services: McpReadServices): readonly McpToolDefinition[] {
  return [
    ...buildCvmTools(services),
    ...buildMarketTools(services),
    ...buildRuntimeTools(services),
    ...buildReconciliationTools(services),
  ];
}

export type { McpToolDefinition, McpToolResult, McpToolContent } from './registry-types';
