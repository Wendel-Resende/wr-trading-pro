/**
 * Servidor Streamable HTTP do wr-mcp-pilot (Task 1 do plano MCP Piloto).
 * Reutiliza o catálogo read-only da Fase 4 (`buildToolRegistry`) e aceita
 * `extraTools` para as fases seguintes (proxy CVM/monitoramento/agentes,
 * conta, mercado, trilho de trade). Auditoria: loga tool, args resumidos
 * (apenas as chaves, nunca os valores) e latência. Autenticação Bearer com
 * comparação em tempo constante (`timingSafeEqual`).
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { PrismaClient } from '@prisma/client';
import { createMcpReadServices } from '../ports/mcp-read-service';
import { buildToolRegistry, type McpToolDefinition } from '../tools/registry';
import type { PilotConfig } from './config';

function bearerOk(req: IncomingMessage, token: string): boolean {
  const header = req.headers.authorization ?? '';
  if (!header.startsWith('Bearer ')) return false;
  const presented = Buffer.from(header.slice(7));
  const expected = Buffer.from(token);
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

export async function startPilotServer(
  prisma: PrismaClient,
  config: PilotConfig,
  extraTools: readonly McpToolDefinition[] = [],
): Promise<{ close(): Promise<void>; url: string }> {
  const mcp = new McpServer({ name: 'wr-trade-pro-mcp-pilot', version: '1.0.0' });
  const tools = [...buildToolRegistry(createMcpReadServices(prisma)), ...extraTools];
  for (const tool of tools) {
    // `registerTool`'s generics ficam excessivamente profundos quando
    // `inputSchema` é um `ZodRawShape` heterogêneo computado em runtime;
    // a sobrecarga sem tipos é a via sancionada pelo SDK para este
    // padrão de registro dinâmico (mesma justificativa de `server.ts`
    // do MCP read-only, Fase 4).
    (mcp.registerTool as (n: string, c: unknown, h: unknown) => void)(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      async (args: Record<string, unknown>) => {
        const started = Date.now();
        const result = await tool.handler(args ?? {});
        console.log(`[mcp-pilot] ${tool.name} privilege=${tool.privilege} args=${JSON.stringify(Object.keys(args ?? {}))} isError=${result.isError === true} ms=${Date.now() - started}`);
        return result;
      },
    );
  }
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
  await mcp.connect(transport);

  const http = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (!req.url?.startsWith('/mcp')) { res.writeHead(404).end(); return; }
    if (!bearerOk(req, config.token)) {
      res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Não autenticado.' }));
      return;
    }
    void transport.handleRequest(req, res);
  });
  await new Promise<void>((resolve) => http.listen(config.port, config.host, resolve));
  const address = http.address();
  const port = typeof address === 'object' && address ? address.port : config.port;
  return {
    url: `http://${config.host}:${port}`,
    close: async () => { await mcp.close(); await new Promise<void>((r) => http.close(() => r())); },
  };
}
