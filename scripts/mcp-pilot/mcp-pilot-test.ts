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
import { ReadModelError } from '../../src/application/read-models-v1/errors';

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
    console.log('servidor HTTP + Bearer + catálogo read-only: OK');
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
  const prisma = new PrismaClient();
  try { await serverTests(prisma); } finally { await prisma.$disconnect(); }
  console.log('MCP Piloto — Task 2: TODOS OS TESTES PASSARAM');
}
void main().catch((e) => { console.error(e); process.exitCode = 1; });
