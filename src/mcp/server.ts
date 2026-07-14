/**
 * Monta o servidor MCP read-only (Fase 4). SEM LLM: apenas repassa
 * chamadas de tool para os services de leitura via `McpReadServices`.
 * SEM escrita: nenhuma tool registrada aqui chama `save*`/`create*`/
 * `update*`/`cancel*`/`execute*`.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { PrismaClient } from '@prisma/client';
import { createMcpReadServices } from './ports/mcp-read-service';
import { buildToolRegistry } from './tools/registry';

export const MCP_SERVER_NAME = 'wr-trade-pro-mcp-read-only';
export const MCP_SERVER_VERSION = '1.0.0';

export function createReadOnlyMcpServer(prisma: PrismaClient): McpServer {
  const server = new McpServer({ name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION });
  const services = createMcpReadServices(prisma);
  const tools = buildToolRegistry(services);

  for (const tool of tools) {
    // `registerTool`'s generics are excessively deep when `inputSchema` is a
    // heterogeneous `ZodRawShape` computed at runtime (not a shape literal
    // known at the call site); the untyped overload is the SDK-sanctioned
    // escape hatch for exactly this dynamic-registration pattern.
    (server.registerTool as (name: string, config: unknown, handler: unknown) => void)(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      async (args: Record<string, unknown>) => tool.handler(args ?? {}),
    );
  }

  return server;
}
