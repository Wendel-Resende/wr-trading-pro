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
import { buildPortfolioTools } from './tools/portfolio';
import { buildMarketLiveTools } from './tools/market-live';
import { buildTradeTools } from './tools/trade';
import { createBridgeClient } from './clients/mt5-bridge';
import { Mt5DemoBroker } from './execution/mt5-demo-broker';
import { createBridgeSnapshot } from './execution/bridge-snapshot';
import { createMcpTradeService } from '../../application/mcp-trade/compose';

async function main(): Promise<void> {
  const config = resolvePilotConfig();
  const prisma = new PrismaClient();
  const next = createHttpJson(config.nextBaseUrl, { bearer: config.serviceToken });
  // spread_api.py / volatility_api.py são serviços Flask locais sem
  // autenticação (bind loopback + CORS allowlist via `network_config`) —
  // por isso nenhum Bearer é passado a esses dois clientes.
  const spread = createHttpJson(config.spreadApiUrl);
  const volatility = createHttpJson(config.volatilityApiUrl);
  const bridge = createBridgeClient(config.bridgeUrl);
  const broker = new Mt5DemoBroker(bridge);
  const snapshot = createBridgeSnapshot(bridge);
  const tradeService = createMcpTradeService(prisma, broker, snapshot);
  const extraTools = [
    ...buildCvmRichTools(next),
    ...buildMonitoringTools(next),
    ...buildAgentActionTools(next),
    ...buildPortfolioTools(bridge),
    ...buildMarketLiveTools(spread, volatility),
    ...buildTradeTools(tradeService),
  ];
  const handle = await startPilotServer(prisma, config, extraTools);
  console.log(`[mcp-pilot] servindo em ${handle.url}/mcp (host=${config.host})`);
}
void main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; });
