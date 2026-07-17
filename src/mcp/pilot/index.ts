/**
 * Entrypoint do wr-mcp-pilot. Sempre HTTP+Bearer (diferente do MCP
 * read-only stdio da Fase 4) — fail-closed: `resolvePilotConfig` lança
 * antes de subir qualquer coisa se os tokens obrigatórios não estiverem
 * configurados (ver `config.ts`).
 */
import { PrismaClient } from '@prisma/client';
import { resolvePilotConfig } from './config';
import { startPilotServer } from './server';
import { createHttpJson } from './clients/http-json';
import { buildCvmRichTools } from './tools/cvm-rich';
import { buildMonitoringTools } from './tools/monitoring';
import { buildAgentActionTools } from './tools/agent-actions';

async function main(): Promise<void> {
  const config = resolvePilotConfig();
  const prisma = new PrismaClient();
  const next = createHttpJson(config.nextBaseUrl, { bearer: config.serviceToken });
  const extraTools = [...buildCvmRichTools(next), ...buildMonitoringTools(next), ...buildAgentActionTools(next)];
  const handle = await startPilotServer(prisma, config, extraTools);
  console.log(`[mcp-pilot] servindo em ${handle.url}/mcp (host=${config.host})`);
}
void main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; });
