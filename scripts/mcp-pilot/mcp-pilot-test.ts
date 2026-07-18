import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PrismaClient } from '@prisma/client';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { resolvePilotConfig, PilotConfigError } from '../../src/mcp/pilot/config';
import { startPilotServer } from '../../src/mcp/pilot/server';
import { isValidServiceToken } from '../../src/lib/auth/service-token';
import { createHttpJson } from '../../src/mcp/pilot/clients/http-json';
import { buildCvmRichTools } from '../../src/mcp/pilot/tools/cvm-rich';
import { buildMonitoringTools } from '../../src/mcp/pilot/tools/monitoring';
import { buildAgentActionTools } from '../../src/mcp/pilot/tools/agent-actions';
import { buildPortfolioTools } from '../../src/mcp/pilot/tools/portfolio';
import { createBridgeClient, type WebSocketLike } from '../../src/mcp/pilot/clients/mt5-bridge';
import { buildMarketLiveTools } from '../../src/mcp/pilot/tools/market-live';
import { buildMlTools } from '../../src/mcp/pilot/tools/ml';
import { buildTradeTools } from '../../src/mcp/pilot/tools/trade';
import { Mt5DemoBroker } from '../../src/mcp/pilot/execution/mt5-demo-broker';
import { createBridgeSnapshot } from '../../src/mcp/pilot/execution/bridge-snapshot';
import { ReadModelError } from '../../src/application/read-models-v1/errors';
import { createRiskPolicyService } from '../../src/application/risk-policy';
import { createOrderIntentService } from '../../src/application/order-intent';
import { McpTradeService, type MarketSnapshotPort } from '../../src/application/mcp-trade/service';
import type { PilotExecutionPort, PilotOrderRequest, PilotOrderResult } from '../../src/domain/v1/ports/pilot-execution';

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
  return {
    ...process.env,
    WR_MCP_HTTP_TOKEN: undefined,
    WR_SERVICE_TOKEN: undefined,
    WR_MCP_HTTP_HOST: undefined,
    WR_MCP_HTTP_PORT: undefined,
    WR_MCP_NEXT_BASE_URL: undefined,
    WR_MCP_SPREAD_API_URL: undefined,
    WR_MCP_VOLATILITY_API_URL: undefined,
    WR_MCP_BRIDGE_URL: undefined,
    ...overrides,
  };
}

function serviceTokenTests(): void {
  const env = fakeEnv({ WR_SERVICE_TOKEN: 's'.repeat(40) });
  assert.equal(isValidServiceToken(`Bearer ${'s'.repeat(40)}`, env), true);
  assert.equal(isValidServiceToken('Bearer errado', env), false);
  assert.equal(isValidServiceToken(undefined, env), false);
  // fail-closed: sem env ou token curto, nada passa
  assert.equal(isValidServiceToken(`Bearer ${'s'.repeat(40)}`, fakeEnv({})), false);
  assert.equal(isValidServiceToken('Bearer abc', fakeEnv({ WR_SERVICE_TOKEN: 'abc' })), false);
  console.log('service token: OK (Bearer válido aceito; fail-closed sem env/curto)');
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

    // Sessões múltiplas: um SEGUNDO cliente (nova sessão MCP) precisa
    // conseguir inicializar depois do primeiro — reconexão do Hermes.
    // Regressão do achado E2E "Server already initialized".
    const transport2 = new StreamableHTTPClientTransport(new URL(`${handle.url}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
    });
    const client2 = new Client({ name: 'test-2', version: '0.0.0' });
    await client2.connect(transport2);
    const tools2 = await client2.listTools();
    assert.ok(tools2.tools.length >= 8, 'segunda sessão deveria listar o catálogo normalmente');
    await client2.close();

    console.log('servidor HTTP + Bearer + catálogo read-only: OK (2 sessões sequenciais)');
  } finally {
    await handle.close();
  }
}

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

async function portfolioToolsTests(): Promise<void> {
  const calls: { type: string; data?: Record<string, unknown> }[] = [];
  const stubBridge = {
    request: async (type: string, data?: Record<string, unknown>) => { calls.push({ type, data }); return { fixture: true }; },
  };
  const tools = buildPortfolioTools(stubBridge);
  assert.ok(tools.every((t) => t.privilege === 'free'));
  await tools.find((t) => t.name === 'portfolio.get_positions')!.handler({});
  assert.equal(calls[0].type, 'GET_POSITIONS_SNAPSHOT');
  await tools.find((t) => t.name === 'portfolio.get_account')!.handler({});
  assert.equal(calls[1].type, 'GET_ACCOUNT_INFO');
  await tools.find((t) => t.name === 'orders.list_open')!.handler({});
  assert.equal(calls[2].type, 'GET_ORDERS_SNAPSHOT');
  await tools.find((t) => t.name === 'orders.history')!.handler({});
  assert.equal(calls[3].type, 'GET_HISTORY_SNAPSHOT');
  await tools.find((t) => t.name === 'market.get_live_candles')!.handler({ symbol: 'PETR4', timeframe: 'H1', count: 100 });
  assert.equal(calls[4].type, 'GET_CHART_DATA');
  assert.deepEqual(calls[4].data, { symbol: 'PETR4', timeframe: 'H1', count: 100 });
  await tools.find((t) => t.name === 'market.get_order_book')!.handler({ symbol: 'PETR4' });
  assert.equal(calls[5].type, 'GET_ORDER_BOOK');

  const down = { request: async () => { throw new ReadModelError('MT5_DISCONNECTED', 'MT5 não conectado'); } };
  const result = await buildPortfolioTools(down).find((t) => t.name === 'portfolio.get_account')!.handler({});
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /MT5_DISCONNECTED/);
  console.log('tools de conta/ordens/candles/book: OK (stub bridge; erro claro sem MT5)');
}

/**
 * Socket fake para testar `createBridgeClient` sem servidor WS real —
 * implementa só o subconjunto de `WebSocketLike` usado pelo cliente,
 * disparando os handlers registrados via `addEventListener` manualmente.
 */
class FakeSocket implements WebSocketLike {
  readyState = 0; // CONNECTING
  readonly sent: string[] = [];
  readonly listeners: Record<'open' | 'message' | 'close' | 'error', Array<(event: any) => void>> = {
    open: [], message: [], close: [], error: [],
  };
  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: any) => void): void {
    this.listeners[type].push(listener);
  }
  removeEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: any) => void): void {
    this.listeners[type] = this.listeners[type].filter((l) => l !== listener);
  }
  send(data: string): void { this.sent.push(data); }
  close(): void { this.readyState = 3; }
  private emit(type: 'open' | 'message' | 'close' | 'error', event: any): void {
    for (const listener of [...this.listeners[type]]) listener(event);
  }
  open(): void { this.readyState = 1; this.emit('open', {}); }
  message(payload: unknown): void { this.emit('message', { data: JSON.stringify(payload) }); }
}

async function flush(times = 1): Promise<void> {
  for (let i = 0; i < times; i++) await new Promise<void>((r) => setImmediate(r));
}

async function bridgeSerializationTests(): Promise<void> {
  const prevSecret = process.env.WR_WS_TOKEN_SECRET;
  process.env.WR_WS_TOKEN_SECRET = 'x'.repeat(40);
  try {
    const sockets: FakeSocket[] = [];
    const bridge = createBridgeClient('ws://fake-bridge', {
      socketFactory: () => { const s = new FakeSocket(); sockets.push(s); return s; },
    });

    // Dois requests de tipos DISTINTOS disparados em paralelo — o bug
    // corrigido era: um ERROR chegando durante o 1º rejeitava a Promise
    // errada se ambos estivessem "em voo" ao mesmo tempo.
    const p1 = bridge.request('GET_ACCOUNT_INFO');
    const p2 = bridge.request('GET_ORDER_BOOK', { symbol: 'PETR4' });

    for (let i = 0; i < 20 && sockets.length === 0; i++) await flush();
    assert.equal(sockets.length, 1, 'as duas requisições devem reusar um único socket');
    const sock = sockets[0];
    for (let i = 0; i < 20 && sock.listeners.open.length === 0; i++) await flush();
    sock.open();
    for (let i = 0; i < 20 && sock.sent.length === 0; i++) await flush();
    assert.equal(JSON.parse(sock.sent[0]).type, 'AUTH');
    sock.message({ type: 'AUTH_OK', data: { sub: 'mcp-pilot' } });

    for (let i = 0; i < 20 && sock.sent.length < 2; i++) await flush();
    assert.equal(sock.sent.length, 2, 'após o handshake, só o 1º request deve estar em voo (serialização)');
    assert.equal(JSON.parse(sock.sent[1]).type, 'GET_ACCOUNT_INFO');

    // Prova de serialização: o 2º request NÃO foi enviado ainda.
    await flush(5);
    assert.equal(sock.sent.length, 2, 'o 2º request não pode ser enviado antes da resposta do 1º');

    // ERROR chega enquanto só GET_ACCOUNT_INFO está ativo — deve rejeitar
    // exatamente essa Promise, com o código certo.
    sock.message({ type: 'ERROR', data: { message: 'MT5 não conectado', code: 'NOT_CONNECTED' } });
    let firstError: unknown;
    try { await p1; } catch (e) { firstError = e; }
    assert.ok(firstError instanceof ReadModelError, 'p1 deve rejeitar com ReadModelError');
    assert.equal((firstError as ReadModelError).code, 'MT5_DISCONNECTED');

    // Com o 1º liberado, o 2º request (tipo diferente) é enviado e conclui normalmente.
    for (let i = 0; i < 20 && sock.sent.length < 3; i++) await flush();
    assert.equal(sock.sent.length, 3);
    assert.equal(JSON.parse(sock.sent[2]).type, 'GET_ORDER_BOOK');
    sock.message({ type: 'ORDERBOOK', data: { symbol: 'PETR4', bids: [], asks: [] } });
    const result2 = await p2;
    assert.deepEqual(result2, { symbol: 'PETR4', bids: [], asks: [] });

    console.log('bridge MT5: serialização de requests + ERROR correlacionado à Promise ativa certa: OK');
  } finally {
    if (prevSecret === undefined) delete process.env.WR_WS_TOKEN_SECRET;
    else process.env.WR_WS_TOKEN_SECRET = prevSecret;
  }
}

async function marketLiveToolsTests(): Promise<void> {
  const seen: { method?: string; url?: string; body?: unknown } = {};
  const stub = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      seen.method = req.method; seen.url = req.url;
      seen.body = raw ? JSON.parse(raw) : undefined;
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ spot: 10, volatility: {}, calls: [], puts: [], top: [] }));
    });
  });
  await new Promise<void>((r) => stub.listen(0, '127.0.0.1', r));
  const stubUrl = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
  try {
    const spread = createHttpJson(stubUrl);
    const volatility = createHttpJson(stubUrl);
    const tools = buildMarketLiveTools(spread, volatility);
    assert.ok(tools.every((t) => t.privilege === 'free'));

    const scan = tools.find((t) => t.name === 'market.scan_options')!;
    const result = await scan.handler({ symbol: 'petr4' });
    assert.equal(result.isError, undefined);
    assert.equal(seen.method, 'POST');
    assert.equal(seen.url, '/api/options/scan');
    assert.deepEqual(seen.body, { symbol: 'PETR4', capital: 10_000, strike_range_pct: 10, min_annual_pct: 5 });
    console.log('market.scan_options: OK (rota, uppercase de símbolo e defaults aplicados)');
  } finally { stub.close(); }
}

async function marketFindSpreadPairsTests(): Promise<void> {
  const seen: { body?: unknown } = {};
  const stub = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      seen.body = raw ? JSON.parse(raw) : undefined;
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ pairs: [] }));
    });
  });
  await new Promise<void>((r) => stub.listen(0, '127.0.0.1', r));
  const stubUrl = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  try {
    const spread = createHttpJson(stubUrl);
    const volatility = createHttpJson(stubUrl);
    const tools = buildMarketLiveTools(spread, volatility);
    const findPairs = tools.find((t) => t.name === 'market.find_spread_pairs')!;

    // Sem args: `data_inicial`/`data_final` devem ser preenchidos com defaults (hoje e hoje-365d),
    // já que a rota Flask indexa `data['data_inicial']` sem default (KeyError se ausente).
    const result1 = await findPairs.handler({});
    assert.equal(result1.isError, undefined);
    const body1 = seen.body as { data_inicial?: string; data_final?: string; min_correlacao?: number };
    assert.match(body1.data_inicial ?? '', DATE_RE);
    assert.match(body1.data_final ?? '', DATE_RE);
    assert.equal(body1.min_correlacao, undefined);

    // Com args explícitos: datas e min_correlacao repassados como enviados.
    const result2 = await findPairs.handler({ startDate: '2025-01-01', endDate: '2025-06-30', minCorrelation: 0.8 });
    assert.equal(result2.isError, undefined);
    assert.deepEqual(seen.body, { data_inicial: '2025-01-01', data_final: '2025-06-30', min_correlacao: 0.8 });

    console.log('market.find_spread_pairs: OK (data_inicial/data_final sempre presentes, com defaults e valores explícitos)');
  } finally { stub.close(); }
}

async function marketLiveMt5DisconnectedTests(): Promise<void> {
  const stub = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      res.writeHead(503, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'MT5 não disponível/conectado', code: 'MT5_DISCONNECTED' }));
    });
  });
  await new Promise<void>((r) => stub.listen(0, '127.0.0.1', r));
  const stubUrl = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
  try {
    const spread = createHttpJson(stubUrl);
    const volatility = createHttpJson(stubUrl);
    const tools = buildMarketLiveTools(spread, volatility);
    const scan = tools.find((t) => t.name === 'market.scan_options')!;
    const result = await scan.handler({ symbol: 'PETR4' });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /UPSTREAM_ERROR/);
    assert.match(result.content[0].text, /MT5 não disponível\/conectado/);
    console.log('market.scan_options sem MT5: OK (503 MT5_DISCONNECTED vira isError UPSTREAM_ERROR)');
  } finally { stub.close(); }
}

/** Gera candles sintéticos com tendência de alta suave para os testes de ML. */
function syntheticCandles(count: number): Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }> {
  const candles = [];
  let price = 10;
  for (let i = 0; i < count; i++) {
    price += 0.05 + (i % 3 === 0 ? 0.02 : 0);
    candles.push({ time: 1700000000 + i * 3600, open: price - 0.02, high: price + 0.03, low: price - 0.05, close: price, volume: 1000 + i });
  }
  return candles;
}

async function mlToolsTests(): Promise<void> {
  const stubBridge = {
    request: async (_type: string, _data?: Record<string, unknown>) => ({ candles: syntheticCandles(100) }),
  };
  const tools = buildMlTools(stubBridge);
  assert.ok(tools.every((t) => t.privilege === 'free'));

  const predict = tools.find((t) => t.name === 'ml.run_prediction')!;
  const result = await predict.handler({ symbol: 'PETR4', timeframe: 'H1', model: 'ma_crossover' });
  assert.equal(result.isError, undefined);
  const parsed = JSON.parse(result.content[0].text) as { signal?: string; confidence?: number };
  assert.ok(['BUY', 'SELL', 'HOLD'].includes(parsed.signal ?? ''), 'motor real deve devolver signal válido');
  assert.equal(typeof parsed.confidence, 'number');
  console.log('ml.run_prediction: OK (100 candles sintéticos -> signal/confidence do motor real)');

  const shortBridge = { request: async () => ({ candles: syntheticCandles(5) }) };
  const shortTools = buildMlTools(shortBridge);
  const shortPredict = shortTools.find((t) => t.name === 'ml.run_prediction')!;
  const shortResult = await shortPredict.handler({ symbol: 'PETR4', timeframe: 'H1', model: 'ma_crossover' });
  assert.equal(shortResult.isError, true);
  assert.match(shortResult.content[0].text, /INSUFFICIENT_DATA/);
  assert.match(shortResult.content[0].text, /obtidos 5, necess[aá]rios 60/);
  console.log('ml.run_prediction com 5 candles: OK (INSUFFICIENT_DATA com contagens obtidas/necessárias)');
}

/** Broker fake — grava toda chamada; nunca deve ser acionado em caminho de falha do gate. */
class FakeExecutionPort implements PilotExecutionPort {
  readonly calls: PilotOrderRequest[] = [];
  constructor(private readonly result: PilotOrderResult = { ok: true, ticket: 42, price: 30.5 }) {}
  async send(request: PilotOrderRequest): Promise<PilotOrderResult> {
    this.calls.push(request);
    return this.result;
  }
}

const FAKE_SNAPSHOT: MarketSnapshotPort = {
  get: async () => ({ referencePrice: 30, currentPositionQty: 0, portfolioNav: 1_000_000 }),
};

/** Broker fake que sempre lança (simula timeout/erro de conexão) — grava chamadas mesmo assim. */
class ThrowingExecutionPort implements PilotExecutionPort {
  readonly calls: PilotOrderRequest[] = [];
  async send(request: PilotOrderRequest): Promise<PilotOrderResult> {
    this.calls.push(request);
    throw new Error('timeout ao enviar ordem ao broker');
  }
}

function mkClock(startMs: number): { now: () => Date; advanceMinutes: (m: number) => void } {
  let current = startMs;
  return {
    now: () => new Date(current),
    advanceMinutes: (m: number) => { current += m * 60 * 1000; },
  };
}

function buildMcpTradeService(
  prisma: PrismaClient,
  execution: PilotExecutionPort,
  clock: () => Date,
  env: Record<string, string | undefined> = {},
): McpTradeService {
  return new McpTradeService({
    prisma,
    riskPolicy: createRiskPolicyService(prisma),
    orderIntent: createOrderIntentService(prisma),
    execution,
    snapshot: FAKE_SNAPSHOT,
    clock,
    env: { ...process.env, WR_TRADING_ENABLED: undefined, ...env },
  });
}

async function mcpTradeMigrationTests(): Promise<void> {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const sql = readFileSync(
    join(process.cwd(), 'prisma', 'migrations', '20260718001053_add_mcp_trade_proposal', 'migration.sql'),
    'utf8',
  );
  assert.doesNotMatch(sql, /\bALTER\s+TABLE\b/i, 'migração aditiva do Item 6 não pode conter ALTER TABLE');
  assert.doesNotMatch(sql, /\bDROP\s+TABLE\b/i, 'migração aditiva não pode conter DROP TABLE');
  assert.doesNotMatch(sql, /\bDROP\s+COLUMN\b/i, 'migração aditiva não pode conter DROP COLUMN');
  assert.doesNotMatch(sql, /\bDROP\s+INDEX\b/i, 'migração aditiva não pode conter DROP INDEX');
  assert.match(sql, /CREATE TABLE "McpTradeProposal"/);
  assert.match(sql, /CREATE UNIQUE INDEX "McpTradeProposal_proposalId_key"/);
  console.log('migration additivity (mcp-trade): OK (somente CREATE TABLE/INDEX, sem ALTER/DROP)');
}

async function mcpTradeAllowlistRejectionTests(prisma: PrismaClient): Promise<void> {
  const clock = mkClock(Date.UTC(2099, 0, 1));
  const execution = new FakeExecutionPort();
  const service = buildMcpTradeService(prisma, execution, clock.now);
  const result = await service.propose({
    requestedBy: 'tester-allow',
    symbol: 'FORA-DA-LISTA',
    direction: 'BUY',
    volume: 100,
    rationale: 'teste allowlist',
  });
  assert.equal(result.status, 'RISK_REJECTED');
  assert.deepEqual(result.riskReasons, ['INSTRUMENT_NOT_ALLOWED']);
  assert.equal(result.confirmationCode, undefined);
  assert.equal(execution.calls.length, 0);
  console.log('propose fora da allowlist: OK (RISK_REJECTED, sem code, broker não chamado)');
}

async function mcpTradeProposeValidTests(prisma: PrismaClient): Promise<string> {
  const clock = mkClock(Date.UTC(2099, 0, 2));
  const execution = new FakeExecutionPort();
  const service = buildMcpTradeService(prisma, execution, clock.now);
  const result = await service.propose({
    requestedBy: 'tester-valid',
    symbol: 'PETR4',
    direction: 'BUY',
    volume: 100,
    rationale: 'teste proposta válida',
  });
  assert.equal(result.status, 'PENDING_HUMAN');
  assert.equal(result.riskOutcome, 'APPROVED');
  assert.ok(result.confirmationCode && /^\d{6}$/.test(result.confirmationCode), 'code deve ter 6 dígitos');
  assert.ok(result.expiresAt);
  const expiresAt = new Date(result.expiresAt!).getTime();
  assert.equal(expiresAt - clock.now().getTime(), 30 * 60 * 1000);
  assert.equal(execution.calls.length, 0);
  console.log('propose válido: OK (PENDING_HUMAN + code de 6 dígitos + expiresAt +30min)');
  return result.proposalId;
}

async function mcpTradeWrongCodeExpiresTests(prisma: PrismaClient): Promise<void> {
  const clock = mkClock(Date.UTC(2099, 0, 3));
  const execution = new FakeExecutionPort();
  const service = buildMcpTradeService(prisma, execution, clock.now);
  const proposed = await service.propose({
    requestedBy: 'tester-wrongcode',
    symbol: 'VALE3',
    direction: 'BUY',
    volume: 50,
    rationale: 'teste code errado',
  });
  assert.equal(proposed.status, 'PENDING_HUMAN');

  for (let i = 0; i < 2; i++) {
    await expectReadModelErrorLocal(
      service.approve({ proposalId: proposed.proposalId, confirmationCode: '000000' }),
      'INVALID_CODE',
      `tentativa ${i + 1} de código errado`,
    );
  }
  // 3ª tentativa errada -> EXPIRED
  await expectReadModelErrorLocal(
    service.approve({ proposalId: proposed.proposalId, confirmationCode: '000000' }),
    'INVALID_CODE',
    'tentativa 3 de código errado',
  );
  const status = await service.status(proposed.proposalId);
  assert.equal(status.proposal.status, 'EXPIRED');
  assert.equal(execution.calls.length, 0, 'broker nunca deve ser chamado com código errado');
  console.log('approve com code errado 3x: OK (EXPIRED, broker nunca chamado)');
}

async function mcpTradeKillSwitchBlockedTests(prisma: PrismaClient): Promise<void> {
  const clock = mkClock(Date.UTC(2099, 0, 4));
  const execution = new FakeExecutionPort();
  const service = buildMcpTradeService(prisma, execution, clock.now); // WR_TRADING_ENABLED ausente
  const proposed = await service.propose({
    requestedBy: 'tester-killswitch',
    symbol: 'ITUB4',
    direction: 'BUY',
    volume: 50,
    rationale: 'teste kill switch',
  });
  assert.equal(proposed.status, 'PENDING_HUMAN');

  const approved = await service.approve({ proposalId: proposed.proposalId, confirmationCode: proposed.confirmationCode! });
  assert.equal(approved.status, 'APPROVED');
  assert.equal(approved.executionState, 'BLOCKED_KILL_SWITCH');
  assert.equal(execution.calls.length, 0, 'broker nunca deve ser chamado com kill switch desligado');
  console.log('approve com kill switch ausente: OK (APPROVED + BLOCKED_KILL_SWITCH, broker não chamado)');
}

async function mcpTradeExecutedTests(prisma: PrismaClient): Promise<void> {
  const clock = mkClock(Date.UTC(2099, 0, 5));
  const execution = new FakeExecutionPort({ ok: true, ticket: 777, price: 31.2 });
  const service = buildMcpTradeService(prisma, execution, clock.now, { WR_TRADING_ENABLED: 'true' });
  const proposed = await service.propose({
    requestedBy: 'tester-executed',
    symbol: 'BBDC4',
    direction: 'SELL',
    volume: 20,
    rationale: 'teste execução',
  });
  assert.equal(proposed.status, 'PENDING_HUMAN');

  const approved = await service.approve({ proposalId: proposed.proposalId, confirmationCode: proposed.confirmationCode! });
  assert.equal(approved.status, 'EXECUTED');
  assert.equal(execution.calls.length, 1);
  assert.equal(execution.calls[0].comment, `mcp:${proposed.proposalId}`);
  assert.equal(execution.calls[0].symbol, 'BBDC4');
  assert.equal(execution.calls[0].direction, 'SELL');

  const status = await service.status(proposed.proposalId);
  assert.equal(status.proposal.status, 'EXECUTED');
  assert.ok(status.proposal.executionJson);

  // 2ª chamada de approve -> INVALID_STATE (não reexecuta)
  await expectReadModelErrorLocal(
    service.approve({ proposalId: proposed.proposalId, confirmationCode: proposed.confirmationCode! }),
    'INVALID_STATE',
    'segunda chamada de approve não deve reexecutar',
  );
  assert.equal(execution.calls.length, 1, 'broker não pode ser chamado de novo na segunda approve');
  console.log('approve com kill switch ligado: OK (broker chamado com comment mcp:<id>, EXECUTED, executionJson persistido; 2ª approve -> INVALID_STATE sem reexecutar)');
}

async function mcpTradeExpiredByClockTests(prisma: PrismaClient): Promise<void> {
  const clock = mkClock(Date.UTC(2099, 0, 6));
  const execution = new FakeExecutionPort();
  const service = buildMcpTradeService(prisma, execution, clock.now, { WR_TRADING_ENABLED: 'true' });
  const proposed = await service.propose({
    requestedBy: 'tester-clockexpire',
    symbol: 'ABEV3',
    direction: 'BUY',
    volume: 10,
    rationale: 'teste expiração por clock',
  });
  assert.equal(proposed.status, 'PENDING_HUMAN');

  clock.advanceMinutes(31);
  await expectReadModelErrorLocal(
    service.approve({ proposalId: proposed.proposalId, confirmationCode: proposed.confirmationCode! }),
    'PROPOSAL_EXPIRED',
    'clock avançado 31min',
  );
  assert.equal(execution.calls.length, 0, 'broker nunca deve ser chamado em proposta expirada');
  const status = await service.status(proposed.proposalId);
  assert.equal(status.proposal.status, 'EXPIRED');
  console.log('clock avançado 31min: OK (PROPOSAL_EXPIRED, broker nunca chamado)');
}

async function mcpTradeRateLimitTests(prisma: PrismaClient): Promise<void> {
  const clock = mkClock(Date.UTC(2099, 0, 7));
  const execution = new FakeExecutionPort();
  const service = buildMcpTradeService(prisma, execution, clock.now, { WR_MCP_TRADE_MAX_PROPOSALS_PER_HOUR: '10' });
  const requestedBy = 'tester-ratelimit';
  for (let i = 0; i < 10; i++) {
    const result = await service.propose({ requestedBy, symbol: 'WEGE3', direction: 'BUY', volume: 1, rationale: `proposta ${i}` });
    assert.notEqual(result.status, undefined);
  }
  await expectReadModelErrorLocal(
    service.propose({ requestedBy, symbol: 'WEGE3', direction: 'BUY', volume: 1, rationale: 'proposta 11' }),
    'RATE_LIMITED',
    '11ª proposta na última hora',
  );
  console.log('rate limit: OK (10 propostas na última hora ok, 11ª -> RATE_LIMITED)');
}

async function mcpTradeRejectTests(prisma: PrismaClient): Promise<void> {
  const clock = mkClock(Date.UTC(2099, 0, 8));
  const execution = new FakeExecutionPort();
  const service = buildMcpTradeService(prisma, execution, clock.now);
  const proposed = await service.propose({
    requestedBy: 'tester-reject',
    symbol: 'PETR4',
    direction: 'BUY',
    volume: 5,
    rationale: 'teste reject',
  });
  assert.equal(proposed.status, 'PENDING_HUMAN');
  const rejected = await service.reject(proposed.proposalId);
  assert.equal(rejected.status, 'REJECTED');
  const status = await service.status(proposed.proposalId);
  assert.equal(status.proposal.status, 'REJECTED');
  assert.equal(execution.calls.length, 0);
  console.log('reject em PENDING_HUMAN: OK (REJECTED)');
}

async function mcpTradeBrokerThrowsTests(prisma: PrismaClient): Promise<void> {
  const clock = mkClock(Date.UTC(2099, 0, 9));
  const execution = new ThrowingExecutionPort();
  const service = buildMcpTradeService(prisma, execution, clock.now, { WR_TRADING_ENABLED: 'true' });
  const proposed = await service.propose({
    requestedBy: 'tester-brokerthrows',
    symbol: 'PETR4',
    direction: 'BUY',
    volume: 15,
    rationale: 'teste broker lança exceção',
  });
  assert.equal(proposed.status, 'PENDING_HUMAN');

  const approved = await service.approve({ proposalId: proposed.proposalId, confirmationCode: proposed.confirmationCode! });
  assert.equal(approved.status, 'EXECUTION_FAILED');
  assert.equal(approved.execution?.ok, false);
  assert.match(approved.execution?.error ?? '', /timeout/);
  assert.equal(execution.calls.length, 1);

  // Retry: proposta não está mais PENDING_HUMAN -> INVALID_STATE, broker NÃO chamado de novo.
  await expectReadModelErrorLocal(
    service.approve({ proposalId: proposed.proposalId, confirmationCode: proposed.confirmationCode! }),
    'INVALID_STATE',
    'retry de approve após EXECUTION_FAILED',
  );
  assert.equal(execution.calls.length, 1, 'broker não pode ser chamado de novo no retry');

  const status = await service.status(proposed.proposalId);
  assert.equal(status.proposal.status, 'EXECUTION_FAILED');
  assert.ok(status.proposal.executionJson?.includes('timeout'));
  console.log('broker lança exceção: OK (EXECUTION_FAILED sem estado preso; retry -> INVALID_STATE, broker chamado só 1x)');
}

async function mcpTradeReplaySuppressedTests(prisma: PrismaClient): Promise<void> {
  const clock = mkClock(Date.UTC(2099, 0, 10));
  const execution = new FakeExecutionPort();
  const service = buildMcpTradeService(prisma, execution, clock.now, { WR_TRADING_ENABLED: 'true' });
  const proposed = await service.propose({
    requestedBy: 'tester-replay',
    symbol: 'PETR4',
    direction: 'BUY',
    volume: 10,
    rationale: 'teste replay de idempotencyKey pré-existente',
  });
  assert.equal(proposed.status, 'PENDING_HUMAN');

  // Simula uma intent já criada com a MESMA idempotencyKey (proposalId) —
  // cenário do bug original: um approve anterior chegou a criar a intent
  // mas caiu antes de chamar o broker (ex.: processo reiniciado). A
  // `decisionId` vinculada está persistida no registro da proposta.
  const row = await prisma.mcpTradeProposal.findUnique({ where: { proposalId: proposed.proposalId } });
  assert.ok(row?.decisionId);
  const orderIntent = createOrderIntentService(prisma);
  await orderIntent.create(
    {
      decisionId: row!.decisionId!,
      idempotencyKey: proposed.proposalId,
      quantity: 10,
      decisionTime: new Date(clock.now().getTime() + 60_000).toISOString(),
      requestedBy: 'tester-replay',
      approvedBy: 'pre-existing',
    },
    { tradingEnabled: true, policyVersion: 'order-intent/v1' },
  );

  const approved = await service.approve({ proposalId: proposed.proposalId, confirmationCode: proposed.confirmationCode! });
  assert.equal(execution.calls.length, 0, 'replay de idempotencyKey não pode reemitir ordem ao broker');
  assert.notEqual(approved.status, 'EXECUTED', 'replay não deve marcar EXECUTED via reenvio ao broker');
  console.log('replay de idempotencyKey pré-existente: OK (broker NÃO chamado, ordem não duplicada)');
}

async function mcpTradeInvalidVolumeTests(prisma: PrismaClient): Promise<void> {
  const clock = mkClock(Date.UTC(2099, 0, 11));
  const execution = new FakeExecutionPort();
  const service = buildMcpTradeService(prisma, execution, clock.now);
  await expectReadModelErrorLocal(
    service.propose({ requestedBy: 'tester-vol0', symbol: 'PETR4', direction: 'BUY', volume: 0, rationale: 'volume zero' }),
    'INVALID_QUERY',
    'volume 0',
  );
  await expectReadModelErrorLocal(
    service.propose({ requestedBy: 'tester-volneg', symbol: 'PETR4', direction: 'BUY', volume: -5, rationale: 'volume negativo' }),
    'INVALID_QUERY',
    'volume negativo',
  );
  await expectReadModelErrorLocal(
    service.propose({ requestedBy: 'tester-volnan', symbol: 'PETR4', direction: 'BUY', volume: Number.NaN, rationale: 'volume NaN' }),
    'INVALID_QUERY',
    'volume NaN',
  );
  assert.equal(execution.calls.length, 0);
  console.log('volume inválido (0/negativo/NaN): OK (INVALID_QUERY antes de qualquer persistência)');
}

async function expectReadModelErrorLocal(promise: Promise<unknown>, code: string, label: string): Promise<void> {
  try {
    await promise;
    assert.fail(`esperava ReadModelError(${code}) em ${label}`);
  } catch (error) {
    if (error instanceof assert.AssertionError) throw error;
    assert.ok(error instanceof ReadModelError, `${label}: esperava ReadModelError, recebeu ${(error as Error)?.constructor?.name}`);
    assert.equal((error as ReadModelError).code, code, `${label}: código esperado ${code}, recebido ${(error as ReadModelError).code}`);
  }
}

async function mcpTradeServiceTests(prisma: PrismaClient): Promise<void> {
  await mcpTradeMigrationTests();
  await mcpTradeAllowlistRejectionTests(prisma);
  await mcpTradeProposeValidTests(prisma);
  await mcpTradeWrongCodeExpiresTests(prisma);
  await mcpTradeKillSwitchBlockedTests(prisma);
  await mcpTradeExecutedTests(prisma);
  await mcpTradeExpiredByClockTests(prisma);
  await mcpTradeRateLimitTests(prisma);
  await mcpTradeRejectTests(prisma);
  await mcpTradeBrokerThrowsTests(prisma);
  await mcpTradeReplaySuppressedTests(prisma);
  await mcpTradeInvalidVolumeTests(prisma);
}

/** Service fake — grava toda chamada e devolve fixtures; nunca toca Prisma/broker real. */
class FakeMcpTradeService {
  readonly proposeCalls: Array<Record<string, unknown>> = [];
  readonly approveCalls: Array<Record<string, unknown>> = [];
  readonly rejectCalls: string[] = [];
  readonly statusCalls: string[] = [];
  async propose(input: Record<string, unknown>) {
    this.proposeCalls.push(input);
    return { proposalId: 'fixture-proposal', status: 'PENDING_HUMAN', riskOutcome: 'APPROVED', riskReasons: [], confirmationCode: '123456', expiresAt: new Date().toISOString() };
  }
  async approve(input: Record<string, unknown>) {
    this.approveCalls.push(input);
    return { status: 'EXECUTED', executionState: 'SENT', execution: { ok: true, ticket: 1, price: 10 } };
  }
  async reject(proposalId: string) {
    this.rejectCalls.push(proposalId);
    return { status: 'REJECTED' };
  }
  async status(proposalId: string) {
    this.statusCalls.push(proposalId);
    return { proposal: {}, riskDecision: null, intents: [] };
  }
}

const VALID_UUID = '123e4567-e89b-12d3-a456-426614174000';

async function tradeToolsTests(): Promise<void> {
  const fake = new FakeMcpTradeService();
  const tools = buildTradeTools(fake as unknown as McpTradeService);
  assert.equal(tools.length, 4);
  assert.ok(tools.every((t) => t.privilege === 'gated'), 'todas as 4 tools trade.* devem ser gated');
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['trade.approve', 'trade.propose', 'trade.reject', 'trade.status']);

  // SEGURANÇA: `requestedBy` fixado no servidor, nunca vindo de `args` —
  // mesmo que o chamador tente injetar um valor diferente, é ignorado.
  const propose = tools.find((t) => t.name === 'trade.propose')!;
  const proposeResult = await propose.handler({
    symbol: 'petr4', direction: 'BUY', volume: 100, rationale: 'rationale de teste com 10+ chars',
    requestedBy: 'attacker-controlled',
  });
  assert.equal(proposeResult.isError, undefined);
  assert.equal(fake.proposeCalls.length, 1);
  assert.equal(fake.proposeCalls[0].requestedBy, 'mcp:hermes', 'requestedBy deve ser fixo, não vindo de args');
  assert.equal(fake.proposeCalls[0].symbol, 'PETR4', 'símbolo deve ser normalizado para maiúsculo');

  // zod: símbolo inválido rejeitado antes de chamar o service.
  const badSymbol = await propose.handler({ symbol: 'XX', direction: 'BUY', volume: 10, rationale: 'rationale de teste com 10+ chars' });
  assert.equal(badSymbol.isError, true);
  assert.equal(fake.proposeCalls.length, 1, 'service não deve ser chamado com símbolo inválido');

  // zod: código de confirmação com 5 dígitos rejeitado.
  const approve = tools.find((t) => t.name === 'trade.approve')!;
  const badCode = await approve.handler({ proposalId: VALID_UUID, confirmationCode: '12345' });
  assert.equal(badCode.isError, true);
  assert.equal(fake.approveCalls.length, 0, 'service não deve ser chamado com código de 5 dígitos');

  const goodApprove = await approve.handler({ proposalId: VALID_UUID, confirmationCode: '123456' });
  assert.equal(goodApprove.isError, undefined);
  assert.equal(fake.approveCalls.length, 1);
  assert.equal(fake.approveCalls[0].proposalId, VALID_UUID);
  assert.equal(fake.approveCalls[0].confirmationCode, '123456');

  const reject = tools.find((t) => t.name === 'trade.reject')!;
  await reject.handler({ proposalId: VALID_UUID });
  assert.deepEqual(fake.rejectCalls, [VALID_UUID]);

  const status = tools.find((t) => t.name === 'trade.status')!;
  await status.handler({ proposalId: VALID_UUID });
  assert.deepEqual(fake.statusCalls, [VALID_UUID]);

  // proposalId não-UUID rejeitado por zod antes de chegar ao service.
  const badId = await status.handler({ proposalId: 'not-a-uuid' });
  assert.equal(badId.isError, true);
  assert.equal(fake.statusCalls.length, 1, 'service não deve ser chamado com proposalId inválido');

  console.log('tools trade.* (propose/approve/reject/status): OK (4 gated, requestedBy fixo, zod rejeita entradas inválidas)');
}

async function mt5DemoBrokerTests(): Promise<void> {
  const calls: Array<{ type: string; data?: Record<string, unknown> }> = [];
  const successBridge = {
    request: async (type: string, data?: Record<string, unknown>) => {
      calls.push({ type, data });
      return { order: 555, deal: 999, volume: 100, price: 31.4, retcode: 10009 };
    },
  };
  const broker = new Mt5DemoBroker(successBridge);
  const result = await broker.send({ symbol: 'PETR4', direction: 'BUY', volume: 100, stopLoss: 29, takeProfit: 33, comment: 'mcp:test-1' });
  assert.deepEqual(result, { ok: true, ticket: 555, price: 31.4 });
  assert.equal(calls[0].type, 'SEND_ORDER');
  assert.deepEqual(calls[0].data, { symbol: 'PETR4', type: 'ORDER_TYPE_BUY', volume: 100, comment: 'mcp:test-1', sl: 29, tp: 33 });

  const sellCalls: Array<{ type: string; data?: Record<string, unknown> }> = [];
  const sellBridge = { request: async (type: string, data?: Record<string, unknown>) => { sellCalls.push({ type, data }); return { order: 1, price: 1 }; } };
  await new Mt5DemoBroker(sellBridge).send({ symbol: 'VALE3', direction: 'SELL', volume: 50, comment: 'mcp:test-2' });
  assert.equal(sellCalls[0].data?.type, 'ORDER_TYPE_SELL');
  assert.equal(sellCalls[0].data?.sl, undefined, 'sl omitido quando não fornecido');
  assert.equal(sellCalls[0].data?.tp, undefined, 'tp omitido quando não fornecido');

  // Broker NUNCA relança — erro do bridge (ReadModelError) vira {ok:false, error}.
  const failingBridge = { request: async () => { throw new ReadModelError('DEMO_ONLY', 'Execução restrita a conta DEMO (WR_TRADING_DEMO_ONLY=true).'); } };
  const failResult = await new Mt5DemoBroker(failingBridge).send({ symbol: 'PETR4', direction: 'BUY', volume: 1, comment: 'mcp:test-3' });
  assert.equal(failResult.ok, false);
  assert.match(failResult.error ?? '', /DEMO/);

  // Erro genérico (não ReadModelError) também nunca relança.
  const throwingBridge = { request: async () => { throw new Error('erro cru inesperado'); } };
  const genericFail = await new Mt5DemoBroker(throwingBridge).send({ symbol: 'PETR4', direction: 'BUY', volume: 1, comment: 'mcp:test-4' });
  assert.equal(genericFail.ok, false);
  assert.equal(genericFail.error, 'erro cru inesperado');

  console.log('Mt5DemoBroker: OK (mapeamento BUY/SELL, sl/tp omitidos quando ausentes, nunca relança)');
}

async function bridgeSnapshotTests(): Promise<void> {
  const calls: Array<{ type: string; data?: Record<string, unknown> }> = [];
  const bridge = {
    request: async (type: string, data?: Record<string, unknown>) => {
      calls.push({ type, data });
      if (type === 'GET_ACCOUNT_INFO') return { equity: 123_456 };
      if (type === 'GET_POSITIONS_SNAPSHOT') return { positions: [{ symbol: 'PETR4', volume: 200 }, { symbol: 'VALE3', volume: 50 }] };
      if (type === 'GET_CHART_DATA') return { candles: [{ close: 10 }, { close: 30.5 }] };
      throw new Error('tipo inesperado');
    },
  };
  const snapshot = createBridgeSnapshot(bridge);
  const result = await snapshot.get('PETR4');
  assert.deepEqual(result, { referencePrice: 30.5, currentPositionQty: 200, portfolioNav: 123_456 });
  assert.ok(calls.some((c) => c.type === 'GET_CHART_DATA' && c.data?.timeframe === 'M1' && c.data?.count === 1));
  console.log('createBridgeSnapshot: OK (equity->portfolioNav, soma volume por símbolo, close do último candle)');
}

async function fullCatalogTests(prisma: PrismaClient): Promise<void> {
  const cfg = resolvePilotConfig(fakeEnv({ WR_MCP_HTTP_TOKEN: TOKEN, WR_SERVICE_TOKEN: TOKEN, WR_MCP_HTTP_PORT: '0' }));
  const stubBridge = { request: async () => ({}) };
  const stubExecution: PilotExecutionPort = { send: async () => ({ ok: true }) };
  const stubSnapshot: MarketSnapshotPort = { get: async () => ({ referencePrice: 1, currentPositionQty: 0, portfolioNav: 1 }) };
  const tradeService = new McpTradeService({
    prisma, riskPolicy: createRiskPolicyService(prisma), orderIntent: createOrderIntentService(prisma),
    execution: stubExecution, snapshot: stubSnapshot,
  });
  const extraTools = [
    ...buildCvmRichTools(createHttpJson('http://127.0.0.1:1')),
    ...buildMonitoringTools(createHttpJson('http://127.0.0.1:1')),
    ...buildAgentActionTools(createHttpJson('http://127.0.0.1:1')),
    ...buildPortfolioTools(stubBridge),
    ...buildMarketLiveTools(createHttpJson('http://127.0.0.1:1'), createHttpJson('http://127.0.0.1:1')),
    ...buildMlTools(stubBridge),
    ...buildTradeTools(tradeService),
  ];
  const handle = await startPilotServer(prisma, cfg, extraTools);
  try {
    const transport = new StreamableHTTPClientTransport(new URL(`${handle.url}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
    });
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(transport);
    const tools = await client.listTools();
    const gated = tools.tools.filter((t) => (extraTools.find((e) => e.name === t.name)?.privilege ?? 'free') === 'gated');
    assert.ok(tools.tools.length >= 25, `catálogo completo deveria ter bastante tools, achou ${tools.tools.length}`);
    assert.equal(gated.length, 4, `deve haver exatamente 4 tools gated, achou ${gated.length}`);
    for (const name of ['trade.propose', 'trade.approve', 'trade.reject', 'trade.status']) {
      assert.ok(tools.tools.some((t) => t.name === name), `tool ${name} deveria estar no catálogo`);
    }
    await client.close();
    console.log(`catálogo completo do servidor: OK (${tools.tools.length} tools, exatamente 4 gated: trade.*)`);
  } finally {
    await handle.close();
  }
}

async function main(): Promise<void> {
  serviceTokenTests();
  configTests();
  await proxyToolsTests();
  await portfolioToolsTests();
  await bridgeSerializationTests();
  await marketLiveToolsTests();
  await marketFindSpreadPairsTests();
  await marketLiveMt5DisconnectedTests();
  await mlToolsTests();
  await tradeToolsTests();
  await mt5DemoBrokerTests();
  await bridgeSnapshotTests();
  const prisma = new PrismaClient();
  try {
    await serverTests(prisma);
    await mcpTradeServiceTests(prisma);
    await fullCatalogTests(prisma);
  } finally { await prisma.$disconnect(); }
  console.log('MCP Piloto — Task 2: TODOS OS TESTES PASSARAM');
}
void main().catch((e) => { console.error(e); process.exitCode = 1; });
