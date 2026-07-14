/**
 * Entrypoint do servidor MCP read-only (Fase 4). Resolve transporte via
 * env (`WR_MCP_TRANSPORT`, default `stdio`) e nunca abre rede fora do
 * modo `http` explícito. Fail-closed: `http` sem `WR_MCP_HTTP_TOKEN`
 * lança antes de subir qualquer coisa (ver `config.ts`).
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { PrismaClient } from '@prisma/client';
import { resolveMcpConfigFromEnv } from './config';
import { createReadOnlyMcpServer } from './server';

export async function startMcpServer(prisma: PrismaClient): Promise<void> {
  const config = resolveMcpConfigFromEnv();
  const server = createReadOnlyMcpServer(prisma);

  if (config.transport === 'stdio') {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    return;
  }

  // HTTP/SSE está fora de escopo nesta fase (spec seção 3, seção 9). A
  // validação fail-closed de token já ocorreu em `resolveMcpConfigFromEnv`;
  // aqui apenas recusamos servir para não abrir rede sem autenticação real.
  throw new Error('WR_MCP_TRANSPORT=http não é suportado neste ciclo (fora de escopo da Fase 4)');
}

if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaClient } = require('@prisma/client') as typeof import('@prisma/client');
  const prisma = new PrismaClient();
  startMcpServer(prisma).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
