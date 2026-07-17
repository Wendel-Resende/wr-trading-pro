# MCP Piloto — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Servidor MCP Streamable HTTP (`wr-mcp-pilot`) que deixa o Hermes Agent operar toda a plataforma (exceto Admin) com acesso livre, e propor/executar ordens **somente em conta DEMO** com gate humano (`confirmationCode`).

**Architecture:** Abordagem C da spec (`docs/superpowers/specs/2026-07-17-mcp-piloto-design.md`): processo Node standalone que faz proxy das APIs existentes — Next :3001 (com service token), spread_api :5000, volatility_api :5555 e mt5_bridge :8766 (WS + ws-token). Trilho de ordem reusa `RiskPolicyService` e `OrderIntentService`; execução via novo broker DEMO com guarda dura no bridge Python.

**Tech Stack:** TypeScript/Node 22 (WebSocket global, sem dep `ws`), `@modelcontextprotocol/sdk` (StreamableHTTPServerTransport), Zod, Prisma/SQLite, Python (Flask/MetaTrader5).

## Global Constraints

- Fail-closed: `WR_MCP_HTTP_TOKEN` ausente/curto (<32) → processo não sobe; `WR_SERVICE_TOKEN` ausente → Next recusa Bearer; kill switch `WR_TRADING_ENABLED` default `false`; `WR_TRADING_DEMO_ONLY` default `true`.
- Bind default `127.0.0.1`; exposição ao WSL só via `WR_MCP_HTTP_HOST` explícito. Next/Flask/bridge permanecem loopback.
- Toda tool declara `privilege: 'free' | 'gated'`; só o grupo `trade.*` é `gated`.
- Erros sanitizados via `toToolError` (nunca stack/SQL/segredo). Tools de mercado sem MT5 → erro `MT5_DISCONNECTED`, nunca dado sintético.
- Migrações Prisma aditivas (sem ALTER destrutivo/DROP).
- Testes: padrão dos runners existentes (tsc → `.dist` → SQLite temporário fora do repo; ver `scripts/agent-run/run-agent-run-tests.cjs`).
- Commits frequentes, mensagens em pt-BR estilo `feat(mcp-pilot): …`, rodapé `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Estrutura de arquivos (visão geral)

```
src/mcp-pilot/
├── config.ts              # envs do piloto (fail-closed)
├── server.ts              # HTTP + Bearer + StreamableHTTP + catálogo
├── index.ts               # entrypoint (npm run mcp:pilot)
├── clients/
│   ├── http-json.ts       # fetch JSON com timeout + Bearer (Next/Flask)
│   └── mt5-bridge.ts      # cliente WS do bridge (AUTH ws-token, req/resp)
├── tools/
│   ├── cvm-rich.ts        # cvm.list_companies / company_fundamentals / dividends_portfolio
│   ├── monitoring.ts      # monitoring.* / alerts.* / reports.get
│   ├── agent-actions.ts   # agent_run.submit/advance/cancel/list (+DAG builders)
│   ├── portfolio.ts       # portfolio.* / orders.* / market.get_live_candles / get_order_book
│   ├── market-live.ts     # market.scan_options / find_spread_pairs / get_volatility
│   ├── ml.ts              # ml.run_prediction / ml.run_backtest
│   └── trade.ts           # trade.propose/approve/reject/status (gated)
└── execution/
    └── mt5-demo-broker.ts # PilotExecutionPort → bridge SEND_ORDER

src/application/mcp-trade/{service.ts,compose.ts}
src/adapters/prisma/mcp-trade/repository.ts
src/domain/v1/ports/pilot-execution.ts
scripts/mcp-pilot/{run-mcp-pilot-tests.cjs,tsconfig.json,mcp-pilot-test.ts}
python/mt5_bridge.py       # +GET_ACCOUNT_INFO, +guarda DEMO
python/spread_api.py       # +/api/options/scan
docs/MCP_PILOT.md
```

---

### Task 1: Fundação do `wr-mcp-pilot` (config fail-closed, HTTP+Bearer, catálogo com `privilege`)

**Files:**
- Create: `src/mcp-pilot/config.ts`, `src/mcp-pilot/server.ts`, `src/mcp-pilot/index.ts`
- Modify: `src/mcp/tools/registry-types.ts` (campo `privilege`), `src/mcp/tools/{cvm,market,runtime,reconciliation}.ts` (adicionar `privilege: 'free'` em cada tool), `package.json` (scripts)
- Create: `scripts/mcp-pilot/run-mcp-pilot-tests.cjs`, `scripts/mcp-pilot/tsconfig.json`, `scripts/mcp-pilot/mcp-pilot-test.ts`

**Interfaces:**
- Produces: `resolvePilotConfig(env): PilotConfig` com `{ host, port, token, nextBaseUrl, serviceToken }`; `startPilotServer(prisma, config, extraTools?): Promise<{ close(): Promise<void>; url: string }>`; `McpToolDefinition` ganha `readonly privilege: 'free' | 'gated'`.
- Consumes: `buildToolRegistry(services)` do MCP Fase 4 (as 8 tools read-only).

- [ ] **Step 1: Escrever teste que falha** — em `scripts/mcp-pilot/mcp-pilot-test.ts`:

```ts
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { resolvePilotConfig, PilotConfigError } from '../../src/mcp-pilot/config';
import { startPilotServer } from '../../src/mcp-pilot/server';

const TOKEN = 't'.repeat(48);

function configTests(): void {
  // fail-closed: sem token, ou token curto, não sobe
  assert.throws(() => resolvePilotConfig({}), PilotConfigError);
  assert.throws(() => resolvePilotConfig({ WR_MCP_HTTP_TOKEN: 'curto' }), PilotConfigError);
  const cfg = resolvePilotConfig({ WR_MCP_HTTP_TOKEN: TOKEN, WR_SERVICE_TOKEN: TOKEN });
  assert.equal(cfg.host, '127.0.0.1'); // default loopback
  assert.equal(cfg.port, 8790);
  console.log('config fail-closed: OK');
}

async function serverTests(prisma: PrismaClient): Promise<void> {
  const cfg = resolvePilotConfig({ WR_MCP_HTTP_TOKEN: TOKEN, WR_SERVICE_TOKEN: TOKEN, WR_MCP_HTTP_PORT: '0' });
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
```

Copiar `scripts/agent-run/run-agent-run-tests.cjs` para `scripts/mcp-pilot/run-mcp-pilot-tests.cjs` trocando os caminhos (`scripts/mcp-pilot/...`, entry `mcp-pilot-test.js`); copiar o `tsconfig.json` de `scripts/agent-run/` ajustando `include` para `mcp-pilot-test.ts` + `../../src/mcp-pilot/**/*.ts` + `../../src/mcp/**/*.ts` + `../../src/application/**/*.ts` + `../../src/adapters/prisma/**/*.ts` + `../../src/domain/v1/**/*.ts` + `../../src/app/api/v1/_shared/http.ts`. Adicionar em `package.json`: `"mcp:pilot": "tsc -p scripts/mcp-pilot/tsconfig.json && node scripts/mcp-pilot/.dist/src/mcp-pilot/index.js"` e `"test:mcp-pilot": "node scripts/mcp-pilot/run-mcp-pilot-tests.cjs"`.

- [ ] **Step 2: Rodar e ver falhar** — `npm run test:mcp-pilot` → FAIL (módulos `src/mcp-pilot/*` não existem).

- [ ] **Step 3: Implementar** —

`src/mcp-pilot/config.ts`:

```ts
/** Envs do wr-mcp-pilot. Fail-closed: sem WR_MCP_HTTP_TOKEN (>=32) não sobe. */
const MIN_TOKEN = 32;

export class PilotConfigError extends Error {
  constructor(message: string) { super(message); this.name = 'PilotConfigError'; }
}

export interface PilotConfig {
  readonly host: string;
  readonly port: number;
  readonly token: string;
  readonly nextBaseUrl: string;
  readonly serviceToken: string;
  readonly spreadApiUrl: string;
  readonly volatilityApiUrl: string;
  readonly bridgeUrl: string;
}

export function resolvePilotConfig(env: NodeJS.ProcessEnv = process.env): PilotConfig {
  const token = env.WR_MCP_HTTP_TOKEN?.trim() ?? '';
  if (token.length < MIN_TOKEN) {
    throw new PilotConfigError(`WR_MCP_HTTP_TOKEN obrigatório (>= ${MIN_TOKEN} chars): servidor não iniciado`);
  }
  const serviceToken = env.WR_SERVICE_TOKEN?.trim() ?? '';
  if (serviceToken.length < MIN_TOKEN) {
    throw new PilotConfigError(`WR_SERVICE_TOKEN obrigatório (>= ${MIN_TOKEN} chars) para chamar as APIs do Next`);
  }
  const rawPort = env.WR_MCP_HTTP_PORT;
  const port = rawPort === undefined || rawPort === '' ? 8790 : Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new PilotConfigError(`WR_MCP_HTTP_PORT inválido: "${rawPort}"`);
  }
  return Object.freeze({
    host: env.WR_MCP_HTTP_HOST?.trim() || '127.0.0.1',
    port,
    token,
    serviceToken,
    nextBaseUrl: env.WR_MCP_NEXT_BASE_URL?.trim() || 'http://127.0.0.1:3001',
    spreadApiUrl: env.WR_MCP_SPREAD_API_URL?.trim() || 'http://127.0.0.1:5000',
    volatilityApiUrl: env.WR_MCP_VOLATILITY_API_URL?.trim() || 'http://127.0.0.1:5555',
    bridgeUrl: env.WR_MCP_BRIDGE_URL?.trim() || 'ws://127.0.0.1:8766',
  });
}
```

`src/mcp-pilot/server.ts` (auditoria: logar `tool`, args resumidos e latência; comparação de token em tempo constante):

```ts
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { PrismaClient } from '@prisma/client';
import { createMcpReadServices } from '../mcp/ports/mcp-read-service';
import { buildToolRegistry, type McpToolDefinition } from '../mcp/tools/registry';
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
```

`src/mcp-pilot/index.ts`:

```ts
import { PrismaClient } from '@prisma/client';
import { resolvePilotConfig } from './config';
import { startPilotServer } from './server';

async function main(): Promise<void> {
  const config = resolvePilotConfig();
  const prisma = new PrismaClient();
  const handle = await startPilotServer(prisma, config);
  console.log(`[mcp-pilot] servindo em ${handle.url}/mcp (host=${config.host})`);
}
void main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; });
```

Em `src/mcp/tools/registry-types.ts`, adicionar ao `McpToolDefinition`:

```ts
  /** Classificação consciente de privilégio: 'free' = agente chama à vontade; 'gated' = exige fluxo de aprovação humana. */
  readonly privilege: 'free' | 'gated';
```

Adicionar `privilege: 'free',` em cada objeto de tool nos 4 builders (`cvm.ts`, `market.ts`, `runtime.ts`, `reconciliation.ts`) — o compilador aponta os pontos.

- [ ] **Step 4: Rodar e ver passar** — `npm run test:mcp-pilot` → PASS. Rodar também `npm run test:mcp` (suíte antiga continua verde com o campo novo).
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(mcp-pilot): fundação — servidor Streamable HTTP com Bearer, config fail-closed e privilege por tool"`.

---

### Task 2: Service token no middleware do Next (Bearer máquina-a-máquina para `/api/*`)

**Files:**
- Create: `src/lib/auth/service-token.ts`
- Modify: `src/middleware.ts`
- Test: adicionar bloco em `scripts/mcp-pilot/mcp-pilot-test.ts`

**Interfaces:**
- Produces: `isValidServiceToken(header: string | null | undefined, env?): boolean` — aceita apenas `Bearer <WR_SERVICE_TOKEN>`, comparação em tempo constante, fail-closed sem env (>=32 chars).
- Consumes: nada novo.

- [ ] **Step 1: Teste que falha** (bloco novo no test file):

```ts
import { isValidServiceToken } from '../../src/lib/auth/service-token';

function serviceTokenTests(): void {
  const env = { WR_SERVICE_TOKEN: 's'.repeat(40) } as NodeJS.ProcessEnv;
  assert.equal(isValidServiceToken(`Bearer ${'s'.repeat(40)}`, env), true);
  assert.equal(isValidServiceToken('Bearer errado', env), false);
  assert.equal(isValidServiceToken(undefined, env), false);
  // fail-closed: sem env ou token curto, nada passa
  assert.equal(isValidServiceToken(`Bearer ${'s'.repeat(40)}`, {} as NodeJS.ProcessEnv), false);
  assert.equal(isValidServiceToken('Bearer abc', { WR_SERVICE_TOKEN: 'abc' } as NodeJS.ProcessEnv), false);
  console.log('service token: OK (Bearer válido aceito; fail-closed sem env/curto)');
}
```

- [ ] **Step 2: Rodar e ver falhar** — módulo inexistente.
- [ ] **Step 3: Implementar** — `src/lib/auth/service-token.ts` (Edge-safe: sem `node:crypto`; comparação constante manual):

```ts
/**
 * Token de serviço máquina-a-máquina (MCP Piloto). Aceito SOMENTE em rotas
 * /api/* como alternativa à sessão. Fail-closed: env ausente/curta recusa.
 * Edge-safe (sem node:crypto) — usado pelo middleware.
 */
const MIN_LENGTH = 32;

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function isValidServiceToken(header: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  const expected = env.WR_SERVICE_TOKEN?.trim() ?? '';
  if (expected.length < MIN_LENGTH) return false;
  if (!header?.startsWith('Bearer ')) return false;
  return constantTimeEqual(header.slice(7), expected);
}
```

Em `src/middleware.ts`, dentro de `middleware()`, logo antes do bloco `if (await isAuthenticated(request))`:

```ts
  // Token de serviço (MCP Piloto): SOMENTE para rotas de API — páginas continuam por sessão.
  if (routeClass === 'protected-api' && isValidServiceToken(request.headers.get('authorization'))) {
    return NextResponse.next();
  }
```

(com `import { isValidServiceToken } from '@/lib/auth/service-token';` no topo).

- [ ] **Step 4: Rodar e ver passar** — `npm run test:mcp-pilot` PASS; `npx tsc --noEmit` limpo.
- [ ] **Step 5: Commit** — `feat(auth): service token Bearer para /api/* (MCP Piloto), fail-closed`.

---

### Task 3: Clientes HTTP internos + tools proxy — CVM rico, Monitoramento e Agentes

**Files:**
- Create: `src/mcp-pilot/clients/http-json.ts`, `src/mcp-pilot/tools/cvm-rich.ts`, `src/mcp-pilot/tools/monitoring.ts`, `src/mcp-pilot/tools/agent-actions.ts`, `src/mcp-pilot/tools/agent-dags.ts`
- Modify: `src/mcp-pilot/server.ts` já aceita `extraTools` (nada a mudar); `src/mcp-pilot/index.ts` passa a montar as tools (ver Step 3)
- Test: blocos novos em `scripts/mcp-pilot/mcp-pilot-test.ts`

**Interfaces:**
- Produces: `createHttpJson(baseUrl: string, opts?: { bearer?: string; timeoutMs?: number })` → `{ get(path), post(path, body), del(path) }` (JSON in/out; timeout default 30_000 via `AbortSignal.timeout`; erro vira `ReadModelError('UPSTREAM_ERROR' | 'UPSTREAM_TIMEOUT', …)`). `buildCvmRichTools(next)`, `buildMonitoringTools(next)`, `buildAgentActionTools(next)` — todos recebem o client injetado (testável com servidor HTTP stub local) e retornam `readonly McpToolDefinition[]` com `privilege: 'free'`.
- `agent-dags.ts` produce: `buildSimpleDag(kind: 'RESEARCH' | 'PROPOSAL'): AgentRunDag` e `buildCommitteeDag(): AgentRunDag` — espelhos exatos dos builders do `AgentRunsPanel.tsx` (copiar os shapes de lá; o DAG do comitê tem os nós `in/fund/divs/risco/cetico/evidence/synthesis/out` com os mesmos `reads/provides/edges` do teste `COMMITTEE_DAG` em `scripts/agent-run/agent-run-test.ts`).

Mapa tool→rota (contratos já existentes; nenhuma rota nova no Next):

| Tool | Método/rota |
|---|---|
| `cvm.list_companies` | GET `/api/cvm/companies` |
| `cvm.company_fundamentals` `{cdCvm}` | GET `/api/cvm/companies/{cdCvm}` |
| `cvm.dividends_portfolio` | GET `/api/cvm/dividends` |
| `monitoring.list` | GET `/api/stock-monitoring` |
| `monitoring.add` `{symbol, quantity?, avgPrice?}` | POST `/api/stock-monitoring` |
| `monitoring.remove` `{id}` | DELETE `/api/stock-monitoring/{id}` |
| `alerts.list` | GET `/api/stock-alerts` |
| `alerts.create` `{symbol, condition, price}` | POST `/api/stock-alerts` |
| `reports.get` | GET `/api/stock-reports` |
| `agent_run.submit` `{template, kind, question, ticker?, llmProvider?, llmModel?, maxSteps?}` | POST `/api/v1/agent-runs` (corpo montado com DAG do template + budget `{maxSteps, maxCost: 30000 (comitê), timeoutMs: 300000}` + `decisionTime: now+60s` — mesmo shape do `AgentRunsPanel.submit`) |
| `agent_run.advance` `{runId}` | POST `/api/v1/agent-runs/{runId}/advance` |
| `agent_run.cancel` `{runId}` | POST `/api/v1/agent-runs/{runId}/cancel` |
| `agent_run.list` `{limit?, status?}` | GET `/api/v1/agent-runs?…` |

- [ ] **Step 1: Teste que falha** — sobe um `http.createServer` stub local que grava método/rota/headers e devolve JSON fixo; monta as tools com `createHttpJson(stubUrl, { bearer: 'svc-token' })`; chama `tool.handler` e afere: rota certa, `Authorization: Bearer svc-token` presente, resultado JSON repassado, `privilege === 'free'` em todas. Para `agent_run.submit` com `template: 'COMITE'` sem `ticker` válido → `ReadModelError` antes de qualquer HTTP (validar com o mesmo regex do panel: `/^[A-Za-z]{4}\d{1,2}$/`).

```ts
async function proxyToolsTests(): Promise<void> {
  const seen: { method?: string; url?: string; auth?: string } = {};
  const stub = createServer((req, res) => {
    seen.method = req.method; seen.url = req.url; seen.auth = req.headers.authorization;
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((r) => stub.listen(0, '127.0.0.1', r));
  const stubUrl = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
  try {
    const next = createHttpJson(stubUrl, { bearer: 'svc-token' });
    const tools = [...buildCvmRichTools(next), ...buildMonitoringTools(next), ...buildAgentActionTools(next)];
    assert.ok(tools.every((t) => t.privilege === 'free'));
    const listCompanies = tools.find((t) => t.name === 'cvm.list_companies')!;
    const result = await listCompanies.handler({});
    assert.equal(result.isError, undefined);
    assert.equal(seen.url, '/api/cvm/companies');
    assert.equal(seen.auth, 'Bearer svc-token');
    const submit = tools.find((t) => t.name === 'agent_run.submit')!;
    const bad = await submit.handler({ template: 'COMITE', kind: 'RESEARCH', question: 'x', ticker: 'INVALIDO!' });
    assert.equal(bad.isError, true, 'comitê sem ticker B3 válido deve falhar antes do HTTP');
    console.log('tools proxy (CVM/monitoramento/agentes): OK');
  } finally { stub.close(); }
}
```

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** — `http-json.ts`:

```ts
import { ReadModelError } from '../../application/read-models-v1/errors';

export interface HttpJson {
  get(path: string): Promise<unknown>;
  post(path: string, body: unknown): Promise<unknown>;
  del(path: string): Promise<unknown>;
}

export function createHttpJson(baseUrl: string, opts?: { bearer?: string; timeoutMs?: number }): HttpJson {
  const timeoutMs = opts?.timeoutMs ?? 30_000;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts?.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  async function call(method: string, path: string, body?: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const aborted = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      throw new ReadModelError(aborted ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_ERROR', `falha ao chamar ${path}: ${aborted ? `timeout após ${timeoutMs}ms` : 'serviço indisponível'}`);
    }
    const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok) {
      const message = typeof json?.error === 'string' ? json.error : ((json?.error as Record<string, unknown> | undefined)?.message as string | undefined) ?? `HTTP ${response.status}`;
      throw new ReadModelError('UPSTREAM_ERROR', `${path}: ${message}`);
    }
    return json;
  }
  return {
    get: (p) => call('GET', p),
    post: (p, b) => call('POST', p, b),
    del: (p) => call('DELETE', p),
  };
}
```

Cada arquivo de tools segue o padrão do `src/mcp/tools/cvm.ts` (usar `parseToolArgs`, `toToolError`, resultado `{ content: [{ type: 'text', text: JSON.stringify(data) }] }`). Exemplo (o mesmo molde vale para todas):

```ts
// src/mcp-pilot/tools/cvm-rich.ts
import { z } from 'zod';
import { parseToolArgs, toToolError, type McpToolDefinition } from '../../mcp/tools/registry-types';
import type { HttpJson } from '../clients/http-json';

export function buildCvmRichTools(next: HttpJson): readonly McpToolDefinition[] {
  return [
    {
      name: 'cvm.list_companies',
      description: 'Lista as 138 empresas do banco CVM (ticker, nome, setor, proveniência).',
      privilege: 'free',
      inputSchema: {},
      handler: async () => {
        try { return { content: [{ type: 'text', text: JSON.stringify(await next.get('/api/cvm/companies')) }] }; }
        catch (error) { return toToolError(error); }
      },
    },
    {
      name: 'cvm.company_fundamentals',
      description: 'Fundamentos trimestrais completos de uma empresa (cd_cvm) — DRE, margens, ROE, dividendos.',
      privilege: 'free',
      inputSchema: { cdCvm: z.string().min(1).max(10) },
      handler: async (args) => {
        try {
          const { cdCvm } = parseToolArgs({ cdCvm: z.string().min(1).max(10) }, args);
          return { content: [{ type: 'text', text: JSON.stringify(await next.get(`/api/cvm/companies/${encodeURIComponent(cdCvm)}`)) }] };
        } catch (error) { return toToolError(error); }
      },
    },
    {
      name: 'cvm.dividends_portfolio',
      description: 'Score de qualidade de dividendos e carteira 12 vigente (gates Monte Carlo).',
      privilege: 'free',
      inputSchema: {},
      handler: async () => {
        try { return { content: [{ type: 'text', text: JSON.stringify(await next.get('/api/cvm/dividends')) }] }; }
        catch (error) { return toToolError(error); }
      },
    },
  ];
}
```

`agent-actions.ts`: antes do POST de `agent_run.submit`, validar `template ∈ {SIMPLES, COMITE}`, `kind ∈ {RESEARCH, PROPOSAL}` e, se COMITE, `ticker` contra `/^[A-Za-z]{4}\d{1,2}$/` (maiusculizar) — recusa com `ReadModelError('INVALID_QUERY', …)`. `index.ts` monta: `const next = createHttpJson(config.nextBaseUrl, { bearer: config.serviceToken }); startPilotServer(prisma, config, [...buildCvmRichTools(next), ...buildMonitoringTools(next), ...buildAgentActionTools(next)])`.

- [ ] **Step 4: Rodar e ver passar** — `npm run test:mcp-pilot`.
- [ ] **Step 5: Commit** — `feat(mcp-pilot): tools proxy de CVM rico, monitoramento/alertas e ações de agent-run`.

---

### Task 4: Cliente do bridge MT5 + `GET_ACCOUNT_INFO` + tools de conta/ordens/book/candles

**Files:**
- Create: `src/mcp-pilot/clients/mt5-bridge.ts`, `src/mcp-pilot/tools/portfolio.ts`
- Modify: `python/mt5_bridge.py` (novo handler `GET_ACCOUNT_INFO`)
- Test: bloco novo em `scripts/mcp-pilot/mcp-pilot-test.ts` (bridge fake em `ws` local? — não: usar servidor WS fake com a lib nativa é inviável sem dep; o teste usa um **stub de BridgeClient injetado** nas tools) + `python -m py_compile python/mt5_bridge.py`

**Interfaces:**
- Produces: `interface BridgeClient { request(type: string, data?: Record<string, unknown>): Promise<Record<string, unknown>>; }` e `createBridgeClient(url: string): BridgeClient` — conecta com `new WebSocket(url)` (global do Node 22), handshake `{type:'AUTH', token}` com token gerado por `createWsToken(getWsTokenSecret()!, 'mcp-pilot', 30)` de `src/lib/auth/ws-token.ts`, correlaciona resposta pelo mapa `REQUEST_RESPONSE: { GET_ACCOUNT_INFO: 'ACCOUNT_INFO', GET_POSITIONS: 'POSITIONS', GET_ORDERS: 'ORDERS', GET_ORDER_BOOK: 'ORDER_BOOK', GET_CHART_DATA: 'CHART_DATA', SEND_ORDER: 'ORDER_RESULT' }`, timeout 15s por request, `type:'ERROR'` vira `ReadModelError('MT5_DISCONNECTED'|'BRIDGE_ERROR', …)`. Conexão sob demanda com reconexão simples (1 retry).
- `buildPortfolioTools(bridge: BridgeClient)` → `portfolio.get_positions`, `portfolio.get_account`, `orders.list_open`, `orders.history`, `market.get_live_candles` (`{symbol, timeframe, count}` → `GET_CHART_DATA` com wrapper `data: {}` — regra registrada no CLAUDE.md), `market.get_order_book` (`{symbol}`). Todas `privilege: 'free'`.

- [ ] **Step 1 (verificação de contrato):** ler em `python/mt5_bridge.py` os handlers `handle_get_positions` (l.480), `handle_get_orders` (l.509), `handle_get_order_book` (l.538), `handle_get_chart_data` (l.947), `handle_send_order` (l.1109) e **confirmar o `type` exato de cada resposta**; ajustar o mapa `REQUEST_RESPONSE` se divergirem dos nomes acima.
- [ ] **Step 2: Teste que falha** — tools com stub `BridgeClient` (grava `type`/`data`, devolve fixture) → cada tool chama o `type` certo, repassa resultado; stub que lança `ReadModelError('MT5_DISCONNECTED', …)` → tool devolve `isError: true` com o código (nunca dado inventado).

```ts
async function portfolioToolsTests(): Promise<void> {
  const calls: { type: string; data?: Record<string, unknown> }[] = [];
  const stubBridge = {
    request: async (type: string, data?: Record<string, unknown>) => { calls.push({ type, data }); return { fixture: true }; },
  };
  const tools = buildPortfolioTools(stubBridge);
  assert.ok(tools.every((t) => t.privilege === 'free'));
  await tools.find((t) => t.name === 'portfolio.get_positions')!.handler({});
  assert.equal(calls[0].type, 'GET_POSITIONS');
  await tools.find((t) => t.name === 'market.get_live_candles')!.handler({ symbol: 'PETR4', timeframe: 'H1', count: 100 });
  assert.equal(calls[1].type, 'GET_CHART_DATA');
  const down = { request: async () => { throw new ReadModelError('MT5_DISCONNECTED', 'MT5 não conectado'); } };
  const result = await buildPortfolioTools(down).find((t) => t.name === 'portfolio.get_account')!.handler({});
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /MT5_DISCONNECTED/);
  console.log('tools de conta/ordens/candles/book: OK (stub bridge; erro claro sem MT5)');
}
```

- [ ] **Step 3: Ver falhar; implementar.** No Python, adicionar ao dispatcher (`elif msg_type == 'GET_ACCOUNT_INFO':`) e o handler (mesmo molde de `handle_get_positions`):

```python
    async def handle_get_account_info(self, websocket: Any, data: Dict[str, Any]):
        """Dados da conta: saldo, equity, margem, alavancagem, modo (demo/real)."""
        if not MT5_AVAILABLE or not self.is_connected:
            await self._send_error('MT5 não disponível ou não conectado', 'NOT_CONNECTED', websocket=websocket)
            return
        info = mt5.account_info()
        if info is None:
            await self._send_error('account_info() indisponível', 'NO_ACCOUNT_INFO', websocket=websocket)
            return
        await self.send_to_client(websocket, {
            'type': 'ACCOUNT_INFO',
            'data': {
                'login': info.login, 'server': info.server, 'currency': info.currency,
                'balance': info.balance, 'equity': info.equity, 'margin': info.margin,
                'margin_free': info.margin_free, 'leverage': info.leverage,
                'trade_mode': info.trade_mode,  # 0 = ACCOUNT_TRADE_MODE_DEMO
                'is_demo': info.trade_mode == mt5.ACCOUNT_TRADE_MODE_DEMO,
            },
            'timestamp': datetime.now().isoformat(),
        })
```

- [ ] **Step 4: Rodar e ver passar** — `npm run test:mcp-pilot` + `C:\Users\rwres\anaconda3\envs\IA_Day_Trading\python.exe -m py_compile python\mt5_bridge.py`.
- [ ] **Step 5: Commit** — `feat(mcp-pilot): cliente WS do bridge + GET_ACCOUNT_INFO + tools de conta/ordens/candles/book`.

---

### Task 5: Mercado Python (scan de opções server-side, spread, volatilidade) + ML server-side

**Files:**
- Modify: `python/spread_api.py` (rota `POST /api/options/scan`), `python/options/scanner_opcoes.py` (extrair função reutilizável se a lógica for só CLI)
- Create: `src/mcp-pilot/tools/market-live.ts`, `src/mcp-pilot/tools/ml.ts`
- Test: blocos em `scripts/mcp-pilot/mcp-pilot-test.ts` (stubs HTTP/bridge) + `py_compile` dos dois arquivos Python

**Interfaces:**
- Produces (Python): `POST /api/options/scan` body `{symbol, capital, strike_range_pct, min_annual_pct}` → JSON `{spot, volatility: {...}, calls: [...], puts: [...], top: [...]}` reutilizando as funções do scanner (mesma regra OTM da plataforma; grava no banco `data/options/options_data.db` como um scan normal). CORS/bind: usa `network_config` como as rotas existentes.
- Produces (TS): `buildMarketLiveTools(spread: HttpJson, volatility: HttpJson)` → `market.scan_options` (POST spread `/api/options/scan`), `market.find_spread_pairs` `{symbols?, min_correlation?}` (POST spread `/api/spread/find-best-pairs`), `market.get_volatility` `{symbol}` (POST volatility `/api/volatility`); `buildMlTools(bridge: BridgeClient)` → `ml.run_prediction` `{symbol, timeframe, model: 'ma_crossover'|'linear_regression', fastPeriod?, slowPeriod?, count?}` e `ml.run_backtest` (mesmos + params de backtest) — busca candles via `bridge.request('GET_CHART_DATA', …)`, mapeia para `Candle[]` e roda `runMACrossover`/`runLinearRegression`/`runBacktest` de `src/services/mlModels.ts`/`backtesting.ts` **in-process**. Mínimo de candles: `slowPeriod + 10`; menos que isso → `ReadModelError('INSUFFICIENT_DATA', 'candles insuficientes: obtidos N, necessários M')` (melhora o achado "insufficient data" do E2E de 2026-07-17).
- Todas `privilege: 'free'`.

- [ ] **Step 1: Teste que falha** — `market.scan_options` com stub HTTP afere rota `/api/options/scan` e body; `ml.run_prediction` com stub bridge devolvendo 100 candles sintéticos de teste afere que retorna `{signal, confidence}` do motor real; com 5 candles → `INSUFFICIENT_DATA`.
- [ ] **Step 2: Ver falhar.**
- [ ] **Step 3: Implementar** (TS no molde da Task 3; Python: rota fina que chama a função extraída do scanner — a extração é mover o corpo do scan para `def scan_options(symbol, capital, strike_range_pct, min_annual_pct) -> dict` importável, preservando o CLI).
- [ ] **Step 4: Rodar e ver passar** — `npm run test:mcp-pilot` + `py_compile` de `spread_api.py` e `scanner_opcoes.py`.
- [ ] **Step 5: Commit** — `feat(mcp-pilot): scan de opções server-side, spread/volatilidade e ML in-process`.

---

### Task 6: Trilho de trade — persistência, service e regras do gate (broker fake)

**Files:**
- Modify: `prisma/schema.prisma` (+ migração aditiva `add_mcp_trade_proposal`)
- Create: `src/domain/v1/ports/pilot-execution.ts`, `src/adapters/prisma/mcp-trade/repository.ts`, `src/application/mcp-trade/service.ts`, `src/application/mcp-trade/compose.ts`
- Test: blocos em `scripts/mcp-pilot/mcp-pilot-test.ts`

**Interfaces:**
- Prisma (aditivo):

```prisma
model McpTradeProposal {
  id                   String   @id @default(cuid())
  proposalId           String   @unique
  requestedBy          String
  symbol               String
  direction            String   // BUY | SELL
  volume               Float
  stopLoss             Float?
  takeProfit           Float?
  rationale            String
  decisionId           String?  // RiskDecision vinculada (null se risco indisponível)
  status               String   // RISK_REJECTED | PENDING_HUMAN | APPROVED | REJECTED | EXPIRED | EXECUTED | EXECUTION_FAILED
  executionState       String?  // BLOCKED_KILL_SWITCH | SENT | null
  confirmationCodeHash String
  codeAttempts         Int      @default(0)
  expiresAt            DateTime
  executionJson        String?
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  @@index([status, createdAt])
  @@index([requestedBy, createdAt])
}
```

- `pilot-execution.ts`:

```ts
export interface PilotOrderRequest {
  readonly symbol: string;
  readonly direction: 'BUY' | 'SELL';
  readonly volume: number;
  readonly stopLoss?: number;
  readonly takeProfit?: number;
  readonly comment: string; // `mcp:<proposalId>`
}
export interface PilotOrderResult {
  readonly ok: boolean;
  readonly ticket?: number;
  readonly price?: number;
  readonly error?: string;
}
export interface PilotExecutionPort {
  send(request: PilotOrderRequest): Promise<PilotOrderResult>;
}
```

- `McpTradeService` (deps injetadas: `prisma`, `RiskPolicyService` — via `createRiskPolicyService(prisma)` —, `OrderIntentService` — via `createOrderIntentService(prisma)` —, `execution: PilotExecutionPort`, `snapshot: MarketSnapshotPort`, `clock: () => Date` para testes, `env`):
  - `propose(input: { requestedBy; symbol; direction: 'BUY'|'SELL'; volume; stopLoss?; takeProfit?; rationale }): Promise<{ proposalId; status; riskOutcome; riskReasons; confirmationCode?; expiresAt? }>`
    1. **Rate limit:** `count(McpTradeProposal where requestedBy AND createdAt > now-1h) >= WR_MCP_TRADE_MAX_PROPOSALS_PER_HOUR (default 10)` → `ReadModelError('RATE_LIMITED', …)`.
    2. `snapshot.get(symbol)` → `{ referencePrice, currentPositionQty, portfolioNav }` (porta com implementação bridge em prod, fake nos testes).
    3. Monta `TradeProposal` (tipo de `domain/v1/models/risk-policy`) e `RiskEvaluationContext` com `limits` de env: `maxNotional` (`WR_MCP_TRADE_MAX_NOTIONAL`, default 50_000), `maxPositionConcentrationPct` (default 20), `maxProposalsPerRun: 1`, `instrumentAllowlist` (`WR_MCP_TRADE_ALLOWLIST`, default `PETR4,VALE3,ITUB4,BBDC4,ABEV3,WEGE3`).
    4. `riskPolicy.evaluate({ runId: 'mcp:'+proposalId, requestedBy, proposal, context, decisionTime: now+60s }, { tradingEnabled: true, policyVersion: RISK_POLICY_VERSION })` — nota: `tradingEnabled: true` aqui avalia a política; o kill switch REAL é aplicado no `approve` (OrderIntent R1) e no bridge.
    5. `REJECTED` → grava `status: 'RISK_REJECTED'` e retorna motivos (sem code). `APPROVED` → gera code 6 dígitos (`crypto.randomInt(100000, 1000000)`), grava `confirmationCodeHash = sha256(code)`, `status: 'PENDING_HUMAN'`, `expiresAt = now + 30min`, retorna `{confirmationCode, expiresAt}` (única vez que o code aparece).
  - `approve(input: { proposalId; confirmationCode }): Promise<{ status; executionState?; execution? }>`
    - proposta inexistente → `NOT_FOUND`; status ≠ `PENDING_HUMAN` → `INVALID_STATE`; `now > expiresAt` → marca `EXPIRED` e retorna erro `PROPOSAL_EXPIRED`.
    - hash não bate → `codeAttempts++`; na 3ª errada marca `EXPIRED`; erro `INVALID_CODE` (sem revelar o certo).
    - hash ok → `orderIntent.create({ decisionId, idempotencyKey: proposalId, quantity: volume, decisionTime: now+60s, requestedBy, approvedBy: 'user-via-mcp:hermes' }, { tradingEnabled: env.WR_TRADING_ENABLED === 'true', … })`:
      - `TRADING_DISABLED` capturado → `status: 'APPROVED'`, `executionState: 'BLOCKED_KILL_SWITCH'` (rollout etapa 1 — aprovação registrada, nada enviado).
      - intent criada → `execution.send({ …, comment: 'mcp:'+proposalId })` → `ok` → `status: 'EXECUTED'` + `executionJson`; `!ok` → `status: 'EXECUTION_FAILED'` + erro.
  - `reject(proposalId)` → `PENDING_HUMAN` → `REJECTED` (senão `INVALID_STATE`).
  - `status(proposalId)` → linha completa + `RiskDecision` (via `riskPolicy.getDecision`) + intent (via `orderIntent.listByDecisionId`), sem o code/hash.

- [ ] **Step 1: Migração** — adicionar o model, `npx prisma migrate dev --name add_mcp_trade_proposal`; conferir que o SQL é só `CREATE TABLE`/`CREATE INDEX`.
- [ ] **Step 2: Testes que falham** (broker fake registra chamadas; snapshot fake; clock injetado):
  - proposta com símbolo fora da allowlist → `RISK_REJECTED` com reasons, sem code;
  - proposta válida → `PENDING_HUMAN` + code de 6 dígitos + `expiresAt` +30min;
  - `approve` com code errado 3× → `EXPIRED`, broker nunca chamado;
  - `approve` com code certo e `WR_TRADING_ENABLED` ausente → `APPROVED` + `BLOCKED_KILL_SWITCH`, broker nunca chamado;
  - `approve` com kill switch `true` → broker chamado com `comment: 'mcp:<id>'`, `EXECUTED`, `executionJson` persistido; segunda chamada de `approve` → `INVALID_STATE` (não reexecuta);
  - clock avançado 31min → `approve` → `PROPOSAL_EXPIRED`;
  - 10 proposals na última hora → 11ª → `RATE_LIMITED`;
  - `reject` em `PENDING_HUMAN` → `REJECTED`.
- [ ] **Step 3: Ver falhar; implementar** service/repository/compose conforme interfaces acima.
- [ ] **Step 4: Rodar e ver passar** — `npm run test:mcp-pilot` + `npm run test:risk-policy` + `npm run test:order-intent` (regressão).
- [ ] **Step 5: Commit** — `feat(mcp-trade): trilho propose→risk→code→approve→intent com kill switch e rate limit`.

---

### Task 7: Guarda DEMO no bridge + broker real + tools `trade.*` no servidor

**Files:**
- Modify: `python/mt5_bridge.py` (`handle_send_order`: guarda DEMO), `src/mcp-pilot/index.ts` (fiação completa)
- Create: `python/tests/test_demo_guard.py`, `src/mcp-pilot/execution/mt5-demo-broker.ts`, `src/mcp-pilot/tools/trade.ts`
- Test: `python -m unittest python/tests/test_demo_guard.py` + bloco TS com service+tools

**Interfaces:**
- Bridge: logo após o bloco do kill switch em `handle_send_order` (l.~1153), inserir:

```python
        # Guarda DEMO (MCP Piloto): por padrão só conta demo pode operar.
        # Independente do chamador — vale para UI e para o wr-mcp-pilot.
        demo_only = os.environ.get('WR_TRADING_DEMO_ONLY', 'true').lower() in ('true', '1', 'yes')
        if demo_only:
            acct = mt5.account_info()
            if acct is None or acct.trade_mode != mt5.ACCOUNT_TRADE_MODE_DEMO:
                logger.warning("Ordem BLOQUEADA: WR_TRADING_DEMO_ONLY=true e a conta não é DEMO")
                await self.send_to_client(websocket, {
                    'type': 'ERROR',
                    'data': {
                        'message': 'Execução restrita a conta DEMO (WR_TRADING_DEMO_ONLY=true).',
                        'code': 'DEMO_ONLY',
                    },
                    'timestamp': datetime.now().isoformat(),
                })
                return
```

  Extrair a decisão para função pura testável `def is_order_allowed_by_account(demo_only: bool, account) -> bool` no módulo, usada pelo handler — `test_demo_guard.py` testa a função com objetos fake (`trade_mode` 0/1/2, account None) sem MT5 real.
- `mt5-demo-broker.ts`: implementa `PilotExecutionPort` sobre `BridgeClient` — mapeia `direction` para `ORDER_TYPE_BUY`/`ORDER_TYPE_SELL`, monta `{symbol, type, volume, sl, tp, comment}` e `request('SEND_ORDER', data)`; resposta ok → `{ok: true, ticket, price}`; `ReadModelError`/ERROR → `{ok: false, error}` (mensagem sanitizada).
- `trade.ts`: `buildTradeTools(service: McpTradeService)` → 4 tools **`privilege: 'gated'`**; schemas Zod: `trade.propose` `{symbol: z.string().regex(/^[A-Za-z]{4}\d{1,2}$/), direction: z.enum(['BUY','SELL']), volume: z.number().positive().max(10000), stopLoss/takeProfit: z.number().positive().optional(), rationale: z.string().min(10).max(2000)}`; `trade.approve` `{proposalId: z.string().uuid(), confirmationCode: z.string().regex(/^\d{6}$/)}`; `trade.reject` `{proposalId}`; `trade.status` `{proposalId}`.
- `index.ts` final: monta `bridge = createBridgeClient(config.bridgeUrl)`, `broker = new Mt5DemoBroker(bridge)`, `tradeService = createMcpTradeService(prisma, { execution: broker, snapshot: createBridgeSnapshot(bridge) })` e registra TODOS os grupos de tools no `startPilotServer`.

- [ ] **Step 1: Testes que falham** — Python: `is_order_allowed_by_account(True, fake(trade_mode=0)) == True`, `(True, fake(trade_mode=2)) == False`, `(True, None) == False`, `(False, fake(trade_mode=2)) == True`. TS: `trade.propose` via tool handler com service fake; as 4 tools têm `privilege: 'gated'`; catálogo completo do servidor (Task 1 test estendido) agora lista ~30 tools e exatamente 4 `gated`.
- [ ] **Step 2: Ver falhar; implementar.**
- [ ] **Step 3: Rodar e ver passar** — `npm run test:mcp-pilot`, unittest Python, `py_compile`.
- [ ] **Step 4: Regressão completa** — `npx tsc --noEmit`, `npm run build`, `npm run test:agent-run`, `npm run test:mcp`.
- [ ] **Step 5: Commit** — `feat(mcp-pilot): guarda DEMO no bridge, broker de execução e tools trade.* gated`.

---

### Task 8: Docs, envs, verificação E2E com o Hermes e handoff

**Files:**
- Modify: `.env.example` (novas envs com placeholder), `docs/CODEX_HANDOFF.md`, vault `log.md`
- Create: `docs/MCP_PILOT.md`

**Interfaces:** nenhuma nova — entrega documental + validação.

- [ ] **Step 1: `.env.example`** — adicionar (valores placeholder):

```
# MCP Piloto (Hermes)
WR_MCP_HTTP_TOKEN=troque-por-token-de-32+chars
WR_MCP_HTTP_HOST=127.0.0.1        # p/ WSL: IP do vswitch (ex. 172.28.64.1)
WR_MCP_HTTP_PORT=8790
WR_SERVICE_TOKEN=troque-por-token-de-32+chars
WR_MCP_TRADE_ALLOWLIST=PETR4,VALE3,ITUB4,BBDC4,ABEV3,WEGE3
WR_MCP_TRADE_MAX_NOTIONAL=50000
WR_MCP_TRADE_MAX_PROPOSALS_PER_HOUR=10
WR_TRADING_DEMO_ONLY=true
# WR_TRADING_ENABLED permanece false até o fim da etapa 1 do rollout
```

- [ ] **Step 2: `docs/MCP_PILOT.md`** — setup completo: pré-requisitos (Next :3001, serviços Python, MT5 aberto), geração dos tokens, firewall Windows (`New-NetFirewallRule` restringindo a porta 8790 ao range do vswitch WSL), `hermes mcp add wr-trade-pro http://172.28.64.1:8790/mcp` (+ header Authorization no config YAML do Hermes; se o runtime HTTP do Hermes repetir o pitfall 400 do SQX, usar o cliente Python `streamablehttp_client` documentado no vault), catálogo das ~30 tools com privilégio, fluxo de aprovação com `confirmationCode`, rollout em 2 etapas.
- [ ] **Step 3: Verificação E2E real (com o usuário):** subir tudo; do WSL: `list_tools` (~30), `cvm.list_companies`, `agent_run.submit` comitê WEGE3 → advance → resultado; `market.scan_options` PETR4; `portfolio.get_account` (`is_demo: true`); `trade.propose` PETR4 BUY 100 → code → usuário aprova no chat → **etapa 1**: `APPROVED + BLOCKED_KILL_SWITCH`; com `WR_TRADING_ENABLED=true` (decisão do usuário): reexecutar propose/approve → `EXECUTED` com ticket na XPMT5-DEMO; `trade.status` com ciclo completo. Sem MT5 aberto: tools de mercado retornam `MT5_DISCONNECTED`.
- [ ] **Step 4: Handoff + vault** — sessão nova no `CODEX_HANDOFF.md` e entrada no `log.md` do vault (decisão de arquitetura: MCP deixou de ser só-leitura; política de privilégio; guarda DEMO).
- [ ] **Step 5: Commit final** — `docs(mcp-pilot): setup, rollout e validação E2E do MCP Piloto`.

---

## Self-review do plano

1. **Cobertura da spec:** arquitetura/rede/token (T1), service token (T2), CVM rico+monitoramento+agentes (T3), conta/ordens/book/candles + GET_ACCOUNT_INFO (T4), opções server-side+spread+vol+ML (T5), trilho trade com code/expiração/rate limit/kill switch (T6), guarda DEMO+broker+tools gated (T7), docs/firewall/rollout/E2E (T8). `privilege` em toda tool (T1, testado em T7). Auditoria de chamadas (T1, wrapper de log). ✔
2. **Placeholders:** nenhum TBD; os dois pontos deliberadamente verificáveis em execução (types de resposta do bridge em T4 Step 1; extração da função do scanner em T5) são passos de verificação/refatoração com instrução concreta, não lacunas. ✔
3. **Consistência de tipos:** `McpToolDefinition.privilege` definido em T1 e usado em T3–T7; `HttpJson` (T3) consumido em T5; `BridgeClient` (T4) consumido em T5/T7; `PilotExecutionPort`/`PilotOrderRequest` (T6) implementados em T7; nomes de envs idênticos entre T1/T6/T7/T8. ✔
