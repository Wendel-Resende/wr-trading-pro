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
import { buildMarketLiveTools } from '../../src/mcp/pilot/tools/market-live';
import { buildTradeTools } from '../../src/mcp/pilot/tools/trade';
import { buildMlDirectionalTools } from '../../src/mcp/pilot/tools/ml-directional';
import { Mt5DemoBroker } from '../../src/mcp/pilot/execution/mt5-demo-broker';
import { createBridgeSnapshot } from '../../src/mcp/pilot/execution/bridge-snapshot';
import { ReadModelError } from '../../src/application/read-models-v1/errors';
import { Mt5McpError } from '../../src/lib/server/mt5-mcp-client';
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
    // B3SA3 (raiz com dígito, a própria B3 S.A.) precisa ser aceito pelo
    // mesmo validador compartilhado — não pode voltar a lançar INVALID_QUERY.
    const okB3sa3 = await submit.handler({ template: 'COMITE', kind: 'RESEARCH', question: 'x', ticker: 'b3sa3' });
    assert.equal(okB3sa3.isError, undefined, 'comitê com ticker B3SA3 deve ser aceito (raiz com dígito)');
    console.log('tools proxy (CVM/monitoramento/agentes): OK');
  } finally { stub.close(); }
}

async function portfolioToolsTests(): Promise<void> {
  // Sem MT5_MCP_API_KEY: getMt5McpConfig() retorna null e os wrappers
  // nativos falham fail-closed com Mt5McpError('MT5_MCP_NOT_CONFIGURED')
  // antes de qualquer chamada de rede — nunca positions/saldo/candles
  // inventados. Nenhum outro teste deste arquivo define MT5_MCP_API_KEY,
  // então não há estado para salvar/restaurar.
  delete process.env.MT5_MCP_API_KEY;
  const tools = buildPortfolioTools();
  assert.ok(tools.every((t) => t.privilege === 'free'));

  async function assertNotConfigured(name: string, args: Record<string, unknown> = {}): Promise<void> {
    const result = await tools.find((t) => t.name === name)!.handler(args);
    assert.equal(result.isError, true, `${name} deveria falhar sem MT5_MCP_API_KEY`);
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.code, 'MT5_MCP_NOT_CONFIGURED', `${name}: código esperado MT5_MCP_NOT_CONFIGURED, recebido ${payload.code}`);
    assert.equal(typeof payload.message, 'string');
  }

  await assertNotConfigured('portfolio.get_positions');
  await assertNotConfigured('portfolio.get_account');
  await assertNotConfigured('orders.list_open');
  await assertNotConfigured('orders.history');
  await assertNotConfigured('market.get_live_candles', { symbol: 'PETR4', timeframe: 'H1', count: 100 });
  await assertNotConfigured('market.get_order_book', { symbol: 'PETR4' });

  console.log('tools de conta/ordens/candles/book: OK (MT5 MCP nativo, fail-closed sem MT5_MCP_API_KEY, payload sanitizado)');
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


/**
 * Tools de ML no piloto. Repõem a superfície que ficou vazia quando o motor
 * híbrido saiu — o agente estava sem acesso nenhum ao escore de fator.
 */
async function mlDirectionalToolsTests(prisma: PrismaClient): Promise<void> {
  const tools = buildMlDirectionalTools(prisma);
  const nomes = tools.map((t) => t.name).sort();
  assert.deepEqual(nomes, [
    'ml.cost_profiles', 'ml.directional_model', 'ml.directional_ranking',
    'ml.directional_train', 'ml.training_status',
  ]);

  // Nenhuma é `gated`: neste catálogo `gated` significa "passa pelo trilho
  // propose/approve com código de confirmação", e só trade.* passa.
  assert.ok(tools.every((t) => t.privilege === 'free'),
    'tools de ML não podem se rotular gated — não passam pelo trilho de confirmação');

  // Sem modelo ativo: estado honesto, com aviso explícito, nunca ranking vazio mudo.
  const semModelo = await tools.find((t) => t.name === 'ml.directional_ranking')!.handler({});
  const rankingVazio = JSON.parse(semModelo.content[0].text) as { ranking: unknown[]; aviso?: string };
  assert.equal(rankingVazio.ranking.length, 0);
  assert.match(rankingVazio.aviso ?? '', /Nenhum modelo ativo/);
  assert.match(rankingVazio.aviso ?? '', /não invente/i);

  const semModeloInfo = await tools.find((t) => t.name === 'ml.directional_model')!.handler({});
  const info = JSON.parse(semModeloInfo.content[0].text) as { active: unknown; aviso?: string };
  assert.equal(info.active, null);
  assert.match(info.aviso ?? '', /não emite sinal/i);

  // Treino exige perfil de custo existente — nunca custo default.
  const treinar = tools.find((t) => t.name === 'ml.directional_train')!;
  const semPerfil = await treinar.handler({ costProfileId: 'nao-existe' });
  assert.equal(semPerfil.isError, true);
  assert.match(semPerfil.content[0].text, /COST_PROFILE_NOT_FOUND/);

  // Zod rejeita entrada malformada antes de qualquer efeito.
  const semArgumento = await treinar.handler({});
  assert.equal(semArgumento.isError, true);

  // Status sem nenhum treino registrado falha explícito.
  const status = await tools.find((t) => t.name === 'ml.training_status')!.handler({});
  assert.equal(status.isError, true);
  assert.match(status.content[0].text, /TRAINING_RUN_NOT_FOUND/);

  console.log('tools ml.* (ranking/model/cost_profiles/train/status): OK (5 free, guardas verificadas)');
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
  // Mt5DemoBroker.send() foi religado em 2026-08-02 para chamar
  // trade_send_market_order de verdade via MCP nativo — mas neste teste,
  // sem MT5_MCP_API_KEY configurada, continua fail-closed: nunca chama
  // nada, sempre devolve {ok:false} com o erro tipado MT5_MCP_NOT_CONFIGURED.
  delete process.env.MT5_MCP_API_KEY;
  const broker = new Mt5DemoBroker();
  const result = await broker.send({ symbol: 'PETR4', direction: 'BUY', volume: 1, comment: 'mcp:d3-test' });
  assert.equal(result.ok, false);
  assert.equal(typeof result.error, 'string');
  assert.equal(result.ticket, undefined);

  console.log('Mt5DemoBroker: OK (fail-closed sem MT5_MCP_API_KEY; com config real, envia ordem via trade_send_market_order)');
}

async function bridgeSnapshotTests(): Promise<void> {
  // createBridgeSnapshot ignora o bridge e chama os wrappers nativos
  // (getAccountInfo/getPositions/getRates) — sem MT5_MCP_API_KEY,
  // getAccountInfo() falha fail-closed com Mt5McpError('MT5_MCP_NOT_CONFIGURED')
  // antes de qualquer chamada de rede; o bridge nunca é acionado.
  delete process.env.MT5_MCP_API_KEY;
  const snapshot = createBridgeSnapshot();
  await assert.rejects(
    snapshot.get('PETR4'),
    (error: unknown) => {
      assert.ok(error instanceof Mt5McpError, `esperava Mt5McpError, recebeu ${(error as Error)?.constructor?.name}`);
      assert.equal((error as Mt5McpError).code, 'MT5_MCP_NOT_CONFIGURED');
      return true;
    },
  );
  console.log('createBridgeSnapshot: OK (MT5 MCP nativo, fail-closed sem MT5_MCP_API_KEY, bridge nunca chamado)');
}

async function fullCatalogTests(prisma: PrismaClient): Promise<void> {
  const cfg = resolvePilotConfig(fakeEnv({ WR_MCP_HTTP_TOKEN: TOKEN, WR_SERVICE_TOKEN: TOKEN, WR_MCP_HTTP_PORT: '0' }));
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
    ...buildPortfolioTools(),
    ...buildMarketLiveTools(createHttpJson('http://127.0.0.1:1'), createHttpJson('http://127.0.0.1:1')),
    ...buildMlDirectionalTools(prisma),
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
    assert.ok(tools.tools.length >= 30, `catálogo completo deveria ter bastante tools, achou ${tools.tools.length}`);
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
  await marketLiveToolsTests();
  await marketFindSpreadPairsTests();
  await marketLiveMt5DisconnectedTests();
  await tradeToolsTests();
  await mt5DemoBrokerTests();
  await bridgeSnapshotTests();
  const prisma = new PrismaClient();
  try {
    await serverTests(prisma);
    await mcpTradeServiceTests(prisma);
    await mlDirectionalToolsTests(prisma);
  await fullCatalogTests(prisma);
  } finally { await prisma.$disconnect(); }
  console.log('MCP Piloto — Task 2: TODOS OS TESTES PASSARAM');
}
void main().catch((e) => { console.error(e); process.exitCode = 1; });
