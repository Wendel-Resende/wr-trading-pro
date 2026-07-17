import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { resolvePilotConfig, PilotConfigError } from '../../src/mcp/pilot/config';
import { startPilotServer } from '../../src/mcp/pilot/server';

const TOKEN = 't'.repeat(48);

// Next.js aumenta `NodeJS.ProcessEnv` globalmente exigindo `NODE_ENV`
// (via `next-env.d.ts`, carregado pelo `tsconfig.json` raiz que este
// arquivo também casa por `**/*.ts`). Objetos-literal como `{}` não
// satisfazem esse tipo aumentado sob o `tsc --noEmit` raiz, mesmo
// compilando OK isoladamente via `scripts/mcp-pilot/tsconfig.json`
// (que não referencia os tipos do Next). `fakeEnv` espalha
// `process.env` — que sempre tem `NODE_ENV` — para satisfazer ambos os
// tsconfigs, mesmo padrão já usado em `scripts/mcp/mcp-test.ts`.
function fakeEnv(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return { ...process.env, WR_MCP_HTTP_TOKEN: undefined, WR_SERVICE_TOKEN: undefined, WR_MCP_HTTP_PORT: undefined, ...overrides };
}

function configTests(): void {
  // fail-closed: sem token, ou token curto, não sobe
  assert.throws(() => resolvePilotConfig(fakeEnv({})), PilotConfigError);
  assert.throws(() => resolvePilotConfig(fakeEnv({ WR_MCP_HTTP_TOKEN: 'curto' })), PilotConfigError);
  const cfg = resolvePilotConfig(fakeEnv({ WR_MCP_HTTP_TOKEN: TOKEN, WR_SERVICE_TOKEN: TOKEN }));
  assert.equal(cfg.host, '127.0.0.1'); // default loopback
  assert.equal(cfg.port, 8790);
  console.log('config fail-closed: OK');
}

async function serverTests(prisma: PrismaClient): Promise<void> {
  const cfg = resolvePilotConfig(fakeEnv({ WR_MCP_HTTP_TOKEN: TOKEN, WR_SERVICE_TOKEN: TOKEN, WR_MCP_HTTP_PORT: '0' }));
  const handle = await startPilotServer(prisma, cfg);
  try {
    // sem Bearer → 401
    const unauth = await fetch(`${handle.url}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(unauth.status, 401);
    // com Bearer → handshake MCP e catálogo com as 8 tools read-only
    const transport = new StreamableHTTPClientTransport(new URL(`${handle.url}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
    });
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(transport);
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name);
    for (const expected of ['market.get_bars', 'cvm.get_facts', 'b3.get_instrument', 'agent_run.get', 'risk_decision.get', 'order_intent.get', 'reconciliation.report', 'dataset.feature_values']) {
      assert.ok(names.includes(expected), `tool ${expected} deveria estar no catálogo`);
    }
    await client.close();
    console.log('servidor HTTP + Bearer + catálogo read-only: OK');
  } finally {
    await handle.close();
  }
}

async function main(): Promise<void> {
  configTests();
  const prisma = new PrismaClient();
  try { await serverTests(prisma); } finally { await prisma.$disconnect(); }
  console.log('MCP Piloto — Task 1: TODOS OS TESTES PASSARAM');
}
void main().catch((e) => { console.error(e); process.exitCode = 1; });
