/**
 * Testes de contrato e adversariais — fundação server-side do MT5 MCP
 * nativo (build 6060+), Fase 1 da migração
 * (docs internos: ver plano aprovado da missão de migração MT5→MCP).
 *
 * O mock server abaixo fala o protocolo Streamable HTTP REAL (mesmos
 * primitivos `McpServer`/`StreamableHTTPServerTransport` já usados em
 * src/mcp/pilot/server.ts) — não é um fake HTTP genérico. Isso garante que
 * o client (src/lib/server/mt5-mcp-client.ts) é exercitado contra handshake,
 * `Mcp-Session-Id` e `tools/call`/`tools/list` reais, incluindo o cenário
 * documentado do build 6060 ("session not initialized" após handshake ok).
 *
 * Cobre: allowlist/fail-closed de config, handshake + get_workspace_info,
 * retry único em erro de sessão (nunca infinito), tool ausente isolada por
 * capability, host inalcançável, token rejeitado, rota /api/mt5/mcp/status
 * sanitizada, e ausência do Bearer em qualquer log/resposta.
 */

import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { getMt5McpConfig, isAllowedMt5McpHost } from '../../src/lib/server/mt5-mcp-config';
import {
  callMt5Tool,
  listMt5Tools,
  Mt5McpError,
  __resetMt5McpClientForTests,
  __classifyUnknownErrorForTests,
} from '../../src/lib/server/mt5-mcp-client';
import {
  getWorkspaceInfo,
  getAccountInfo,
  getTradingEligibility,
  getPositions,
  getTick,
  getRates,
  getSymbols,
  getHistoryDeals,
  getOrders,
  getSymbolInfo,
  getMarketBook,
  resolveMt5ToolName,
  redactSensitiveFields,
  __resetMt5McpToolCacheForTests,
} from '../../src/lib/server/mt5-mcp-tools';
import { GET as statusGet } from '../../src/app/api/mt5/mcp/status/route';
import { GET as tradingEligibilityGet } from '../../src/app/api/mt5/mcp/trading-eligibility/route';
import { GET as positionsGet } from '../../src/app/api/mt5/mcp/positions/route';
import { GET as tickGet } from '../../src/app/api/mt5/mcp/tick/route';
import { GET as ratesGet } from '../../src/app/api/mt5/mcp/rates/route';
import { GET as symbolsGet } from '../../src/app/api/mt5/mcp/symbols/route';
import { GET as historyGet } from '../../src/app/api/mt5/mcp/history/route';
import { GET as ordersGet } from '../../src/app/api/mt5/mcp/orders/route';
import { GET as symbolInfoGet } from '../../src/app/api/mt5/mcp/symbol-info/route';
import { GET as orderBookGet } from '../../src/app/api/mt5/mcp/order-book/route';
import MT5Service, { filterB3EquityNames } from '../../src/services/mt5Service';

/** Constrói só o shape que a rota de posições lê (nextUrl.searchParams) — sem depender do runtime completo do Next.js. */
function fakePositionsRequest(url: string): Parameters<typeof positionsGet>[0] {
  return { nextUrl: new URL(url) } as unknown as Parameters<typeof positionsGet>[0];
}

/** Idem, para a rota de tick. */
function fakeTickRequest(url: string): Parameters<typeof tickGet>[0] {
  return { nextUrl: new URL(url) } as unknown as Parameters<typeof tickGet>[0];
}

/** Idem, para a rota de rates. */
function fakeRatesRequest(url: string): Parameters<typeof ratesGet>[0] {
  return { nextUrl: new URL(url) } as unknown as Parameters<typeof ratesGet>[0];
}

/** Idem, para a rota de history. */
function fakeHistoryRequest(url: string): Parameters<typeof historyGet>[0] {
  return { nextUrl: new URL(url) } as unknown as Parameters<typeof historyGet>[0];
}

/** Idem, para a rota de orders. */
function fakeOrdersRequest(url: string): Parameters<typeof ordersGet>[0] {
  return { nextUrl: new URL(url) } as unknown as Parameters<typeof ordersGet>[0];
}

/** Idem, para a rota de symbol-info. */
function fakeSymbolInfoRequest(url: string): Parameters<typeof symbolInfoGet>[0] {
  return { nextUrl: new URL(url) } as unknown as Parameters<typeof symbolInfoGet>[0];
}

/** Idem, para a rota de order-book. */
function fakeOrderBookRequest(url: string): Parameters<typeof orderBookGet>[0] {
  return { nextUrl: new URL(url) } as unknown as Parameters<typeof orderBookGet>[0];
}

const TOKEN = '[REDACTED]-mt5-mcp-test-token';

function resetModuleState(): void {
  __resetMt5McpClientForTests();
  __resetMt5McpToolCacheForTests();
}

const MT5_MCP_ENV_KEYS = ['MT5_MCP_ENDPOINT', 'MT5_MCP_API_KEY', 'MT5_MCP_POLL_INTERVAL_MS'];

function resetEnv(): void {
  for (const key of MT5_MCP_ENV_KEYS) delete process.env[key];
  resetModuleState();
}

// ─── Mock server: protocolo Streamable HTTP real ───────────────────────────

interface MockServerHandle {
  readonly url: string;
  close(): Promise<void>;
}

interface MockToolSpec {
  readonly name: string;
  readonly result: () => Promise<{ content: Array<{ type: 'text'; text: string }> }>;
}

interface MockServerOptions {
  readonly token?: string;
  readonly tools?: readonly MockToolSpec[];
  /** Nº de chamadas de tool que falham com "session not initialized" ANTES de funcionar — simula o quirk do build 6060. */
  readonly failSessionChecksCount?: number;
}

function jsonTool(text: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(text) }] };
}

async function startMockMt5Server(options: MockServerOptions = {}): Promise<MockServerHandle> {
  const token = options.token ?? TOKEN;
  const tools =
    options.tools ??
    ([{ name: 'get_workspace_info', result: async () => jsonTool({ root: 'C:\\MetaTrader 5', accountLogin: 12345678 }) }] as const);
  let sessionFailuresRemaining = options.failSessionChecksCount ?? 0;

  const sessions = new Map<string, { mcp: McpServer; transport: StreamableHTTPServerTransport }>();

  function buildServer(): McpServer {
    const mcp = new McpServer({ name: 'MetaTrader5-MCP', version: '1.0.0' });
    for (const tool of tools) {
      mcp.registerTool(tool.name, { description: `mock ${tool.name}` }, async () => {
        if (sessionFailuresRemaining > 0) {
          sessionFailuresRemaining -= 1;
          throw new Error('MCP session is not initialized');
        }
        return tool.result();
      });
    }
    return mcp;
  }

  const http = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      if (!req.url?.startsWith('/mcp')) {
        res.writeHead(404).end();
        return;
      }
      const auth = req.headers.authorization ?? '';
      if (auth !== `Bearer ${token}`) {
        res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
      const sessionId = req.headers['mcp-session-id'];
      const existing = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined;
      if (existing) {
        await existing.transport.handleRequest(req, res);
        return;
      }
      const mcp = buildServer();
      const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid: string) => {
          sessions.set(sid, { mcp, transport });
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) sessions.delete(transport.sessionId);
      };
      await mcp.connect(transport);
      await transport.handleRequest(req, res);
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500).end();
    });
  });

  return new Promise((resolve) => {
    http.listen(0, '127.0.0.1', () => {
      const { port } = http.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}/mcp`,
        close: () =>
          new Promise((r) => {
            for (const [, session] of sessions) void session.mcp.close().catch(() => undefined);
            http.close(() => r());
          }),
      });
    });
  });
}

async function withMockServer<T>(options: MockServerOptions, run: (handle: MockServerHandle) => Promise<T>): Promise<T> {
  const handle = await startMockMt5Server(options);
  try {
    return await run(handle);
  } finally {
    await handle.close();
  }
}

// ─── 1. Config: allowlist + fail-closed ────────────────────────────────────

async function configTests(): Promise<void> {
  resetEnv();

  assert.ok(isAllowedMt5McpHost('127.0.0.1'));
  assert.ok(isAllowedMt5McpHost('localhost'));
  assert.ok(isAllowedMt5McpHost('::1'));
  assert.ok(isAllowedMt5McpHost('172.28.64.1'), 'faixa privada do WSL (172.16-31.x) deveria ser permitida');
  assert.ok(isAllowedMt5McpHost('172.16.0.1'));
  assert.ok(isAllowedMt5McpHost('172.31.255.254'));
  assert.ok(!isAllowedMt5McpHost('172.32.0.1'), 'fora da faixa 172.16-31.x deveria ser rejeitado');
  assert.ok(!isAllowedMt5McpHost('172.15.255.255'));
  assert.ok(!isAllowedMt5McpHost('192.168.1.10'), 'IP de LAN não deveria ser permitido (SSRF)');
  assert.ok(!isAllowedMt5McpHost('evil.example.com'), 'host remoto deveria ser rejeitado (SSRF)');

  // Sem MT5_MCP_API_KEY: fail-closed, nunca infere config parcial.
  assert.equal(await getMt5McpConfig(), null);

  process.env.MT5_MCP_API_KEY = '[REDACTED]';
  const cfg = await getMt5McpConfig();
  assert.ok(cfg);
  assert.equal(cfg!.endpoint, 'http://127.0.0.1:22346/mcp', 'default deveria ser o loopback direto, sem proxy WSL');
  assert.equal(cfg!.pollIntervalMs, 1500);

  // Endpoint remoto: cai no default local (fail-closed), nunca conecta em host arbitrário.
  process.env.MT5_MCP_ENDPOINT = 'http://evil.example.com:22346/mcp';
  assert.equal((await getMt5McpConfig())!.endpoint, 'http://127.0.0.1:22346/mcp');

  // Endpoint na faixa WSL é aceito (cenário de desenvolvimento documentado).
  process.env.MT5_MCP_ENDPOINT = 'http://172.28.64.1:22347/mcp';
  assert.equal((await getMt5McpConfig())!.endpoint, 'http://172.28.64.1:22347/mcp');

  // poll interval fora da faixa cai no default.
  process.env.MT5_MCP_POLL_INTERVAL_MS = '10';
  assert.equal((await getMt5McpConfig())!.pollIntervalMs, 1500);
  process.env.MT5_MCP_POLL_INTERVAL_MS = '3000';
  assert.equal((await getMt5McpConfig())!.pollIntervalMs, 3000);

  resetEnv();
  console.log('config MT5 MCP (allowlist loopback/WSL, fail-closed sem API key): OK');
}

// ─── 2. Handshake real + get_workspace_info (pre-flight obrigatório) ──────

async function handshakeAndWorkspaceInfoTests(): Promise<void> {
  resetEnv();
  await withMockServer({}, async (handle) => {
    process.env.MT5_MCP_ENDPOINT = handle.url;
    process.env.MT5_MCP_API_KEY = TOKEN;

    const info = await getWorkspaceInfo();
    assert.deepEqual(info, { root: 'C:\\MetaTrader 5', accountLogin: 12345678 });

    const tools = await listMt5Tools();
    assert.ok(tools.some((t) => t.name === 'get_workspace_info'));

    const serialized = JSON.stringify({ info, tools });
    assert.ok(!serialized.includes(TOKEN), 'nenhum resultado de tool deveria conter o Bearer');

    resetEnv();
  });
  console.log('handshake real + get_workspace_info (pre-flight obrigatório): OK');
}

// ─── 2b. account_info: redação + terminal sem conta logada ────────────────

async function accountInfoTests(): Promise<void> {
  resetEnv();

  await withMockServer(
    {
      tools: [
        { name: 'get_workspace_info', result: async () => jsonTool({ root: 'C:\\MetaTrader 5' }) },
        {
          name: 'get_account_info',
          result: async () => jsonTool({ login: 555, balance: 1000, password: 'nunca deveria aparecer' }),
        },
      ],
    },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      const info = (await getAccountInfo()) as Record<string, unknown>;
      assert.equal(info.login, 555);
      assert.equal(info.balance, 1000);
      assert.equal(info.password, '[REDACTED]', 'account_info deveria passar pela redação genérica também');

      resetEnv();
    }
  );

  await withMockServer(
    {
      tools: [
        { name: 'get_workspace_info', result: async () => jsonTool({ root: 'C:\\MetaTrader 5' }) },
        {
          name: 'get_account_info',
          result: async () => {
            throw new Error('No account is logged in');
          },
        },
      ],
    },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      await assert.rejects(
        getAccountInfo(),
        (error: unknown) => error instanceof Mt5McpError && error.code === 'MT5_MCP_TERMINAL_DISCONNECTED',
        'terminal sem conta logada deveria classificar como MT5_MCP_TERMINAL_DISCONNECTED, não um erro genérico'
      );

      resetEnv();
    }
  );

  console.log('account_info: OK (redação aplicada; terminal sem conta logada classificado corretamente)');
}

// ─── 2c. Elegibilidade de trading (somente leitura, nunca abre ordem) ──────

async function tradingEligibilityTests(): Promise<void> {
  resetEnv();

  await withMockServer(
    { tools: [{ name: 'get_account_info', result: async () => jsonTool({ tradeAllowed: true }) }] },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;
      assert.deepEqual(await getTradingEligibility(), { tradeAllowed: true });
      resetEnv();
    }
  );

  await withMockServer(
    { tools: [{ name: 'get_account_info', result: async () => jsonTool({ trade_allowed: false }) }] },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;
      const result = await getTradingEligibility();
      assert.equal(result.tradeAllowed, false);
      assert.ok(result.reason, 'deveria explicar por que o trading não está habilitado');
      resetEnv();
    }
  );

  await withMockServer(
    { tools: [{ name: 'get_account_info', result: async () => jsonTool({ balance: 100 }) }] },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;
      const result = await getTradingEligibility();
      assert.equal(result.tradeAllowed, false, 'sem campo reconhecido de permissão, nunca deveria assumir habilitado');
      assert.ok(result.reason);
      resetEnv();
    }
  );

  await withMockServer(
    { tools: [{ name: 'get_account_info', result: async () => jsonTool({ tradeAllowed: true }) }] },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;
      const res = await tradingEligibilityGet();
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.success, true);
      assert.equal(body.data.tradeAllowed, true);
      assert.ok(!JSON.stringify(body).includes(TOKEN));
      resetEnv();
    }
  );

  const notConfiguredRes = await tradingEligibilityGet();
  assert.equal(notConfiguredRes.status, 503);
  const notConfiguredBody = await notConfiguredRes.json();
  assert.equal(notConfiguredBody.error.code, 'MT5_MCP_NOT_CONFIGURED');

  console.log('elegibilidade de trading (somente leitura, nunca abre caminho de ordem): OK');
}

// ─── 3. Redação de campos sensíveis (defesa em profundidade) ─────────────

function redactionTests(): void {
  const redacted = redactSensitiveFields({
    accountLogin: 123,
    password: 'segredo',
    nested: { apiKey: 'sk-abc', ok: 'valor normal' },
    list: [{ token: 'tok-1' }, { fine: 'ok' }],
  }) as Record<string, unknown>;

  assert.equal(redacted.password, '[REDACTED]');
  assert.equal(redacted.accountLogin, 123);
  assert.equal((redacted.nested as Record<string, unknown>).apiKey, '[REDACTED]');
  assert.equal((redacted.nested as Record<string, unknown>).ok, 'valor normal');
  assert.equal(((redacted.list as unknown[])[0] as Record<string, unknown>).token, '[REDACTED]');
  console.log('redação genérica de campos sensíveis: OK');
}

// ─── 4. Retry único em erro de sessão (build 6060 quirk) — nunca infinito ─

async function sessionErrorRetryTests(): Promise<void> {
  resetEnv();

  // Falha 1x, depois funciona — deveria se recuperar com o retry único.
  await withMockServer({ failSessionChecksCount: 1 }, async (handle) => {
    process.env.MT5_MCP_ENDPOINT = handle.url;
    process.env.MT5_MCP_API_KEY = TOKEN;

    const info = await getWorkspaceInfo();
    assert.deepEqual(info, { root: 'C:\\MetaTrader 5', accountLogin: 12345678 });

    resetEnv();
  });

  // Falha sempre — o retry único não deveria virar loop infinito; erro final é MT5_MCP_SESSION_ERROR.
  await withMockServer({ failSessionChecksCount: 999 }, async (handle) => {
    process.env.MT5_MCP_ENDPOINT = handle.url;
    process.env.MT5_MCP_API_KEY = TOKEN;

    await assert.rejects(
      getWorkspaceInfo(),
      (error: unknown) => error instanceof Mt5McpError && error.code === 'MT5_MCP_SESSION_ERROR',
      'sessão sempre quebrada deveria terminar em MT5_MCP_SESSION_ERROR após 1 retry, não travar'
    );

    resetEnv();
  });

  console.log('retry único em erro de sessão (quirk build 6060): OK (recupera 1x; nunca loop infinito)');
}

// ─── 5. Tool ausente falha isolada por capability ─────────────────────────

async function toolMissingTests(): Promise<void> {
  resetEnv();
  // Servidor só expõe uma tool "esquisita" que não bate com nenhum candidato de nenhuma capability.
  await withMockServer(
    { tools: [{ name: 'some_unrelated_tool', result: async () => jsonTool({}) }] },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      await assert.rejects(
        resolveMt5ToolName('workspace_info'),
        (error: unknown) => error instanceof Mt5McpError && error.code === 'MT5_MCP_TOOL_MISSING',
        'capability sem tool candidata correspondente deveria falhar com MT5_MCP_TOOL_MISSING'
      );
      await assert.rejects(
        resolveMt5ToolName('account_info'),
        (error: unknown) => error instanceof Mt5McpError && error.code === 'MT5_MCP_TOOL_MISSING'
      );

      resetEnv();
    }
  );
  console.log('tool ausente no servidor nativo: OK (MT5_MCP_TOOL_MISSING isolado por capability)');
}

// ─── 6. Host inalcançável / token rejeitado ────────────────────────────────

async function unreachableAndAuthTests(): Promise<void> {
  resetEnv();

  // Porta fechada — ninguém escutando.
  process.env.MT5_MCP_ENDPOINT = 'http://127.0.0.1:1';
  process.env.MT5_MCP_API_KEY = TOKEN;
  await assert.rejects(
    getWorkspaceInfo(),
    (error: unknown) => error instanceof Mt5McpError && error.code === 'MT5_MCP_UNREACHABLE',
    'endpoint inalcançável deveria ser classificado como MT5_MCP_UNREACHABLE'
  );
  resetEnv();

  await withMockServer({}, async (handle) => {
    process.env.MT5_MCP_ENDPOINT = handle.url;
    process.env.MT5_MCP_API_KEY = 'token-errado';
    await assert.rejects(
      getWorkspaceInfo(),
      (error: unknown) => error instanceof Mt5McpError,
      'token rejeitado deveria propagar como Mt5McpError classificado'
    );
    resetEnv();
  });

  console.log('endpoint inalcançável / token rejeitado: OK (erros classificados, nunca mensagem bruta)');
}

// ─── 7. Rota /api/mt5/mcp/status ───────────────────────────────────────────

async function statusRouteTests(): Promise<void> {
  resetEnv();

  // Sem MT5_MCP_API_KEY: 503 fail-closed, nunca finge conectado.
  const notConfiguredRes = await statusGet();
  assert.equal(notConfiguredRes.status, 503);
  const notConfiguredBody = await notConfiguredRes.json();
  assert.equal(notConfiguredBody.success, false);
  assert.equal(notConfiguredBody.error.code, 'MT5_MCP_NOT_CONFIGURED');

  await withMockServer(
    {
      tools: [
        { name: 'get_workspace_info', result: async () => jsonTool({ root: 'C:\\MetaTrader 5', accountLogin: 12345678 }) },
        { name: 'get_account_info', result: async () => jsonTool({ login: 12345678, balance: 1000, tradeAllowed: true }) },
      ],
    },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      const res = await statusGet();
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.success, true);
      assert.equal(body.data.connected, true);
      assert.deepEqual(body.data.workspaceInfo, { root: 'C:\\MetaTrader 5', accountLogin: 12345678 });
      assert.deepEqual(body.data.accountInfo, { login: 12345678, balance: 1000, tradeAllowed: true });
      assert.equal(body.data.accountError, undefined);

      const serialized = JSON.stringify(body);
      assert.ok(!serialized.includes(TOKEN), 'resposta da rota NUNCA deveria conter o Bearer');
      assert.ok(!serialized.toLowerCase().includes('authorization'), 'resposta não deveria vazar o header usado internamente');

      resetEnv();
    }
  );

  // Terminal aberto, sessão MCP ok, mas nenhuma conta logada na GUI — estado
  // válido (não fatal): connected:true, accountInfo:null, accountError preenchido.
  await withMockServer(
    {
      tools: [
        { name: 'get_workspace_info', result: async () => jsonTool({ root: 'C:\\MetaTrader 5' }) },
        {
          name: 'get_account_info',
          result: async () => {
            throw new Error('No account is logged in');
          },
        },
      ],
    },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      const res = await statusGet();
      assert.equal(res.status, 200, 'terminal sem conta logada não deveria ser tratado como falha fatal da rota');
      const body = await res.json();
      assert.equal(body.success, true);
      assert.equal(body.data.connected, true);
      assert.equal(body.data.accountInfo, null);
      assert.equal(body.data.accountError.code, 'MT5_MCP_TERMINAL_DISCONNECTED');

      resetEnv();
    }
  );

  // Servidor fora do ar: 502 com erro classificado, não 200 nem stack trace.
  process.env.MT5_MCP_ENDPOINT = 'http://127.0.0.1:1';
  process.env.MT5_MCP_API_KEY = TOKEN;
  const unreachableRes = await statusGet();
  assert.equal(unreachableRes.status, 502);
  const unreachableBody = await unreachableRes.json();
  assert.equal(unreachableBody.success, false);
  assert.equal(unreachableBody.error.code, 'MT5_MCP_UNREACHABLE');
  assert.ok(!JSON.stringify(unreachableBody).match(/econnrefused|stack|at\s+\w+\s+\(/i), 'nunca deveria vazar detalhe de rede/stack');

  resetEnv();
  console.log('rota /api/mt5/mcp/status: OK (503 sem config, 200 sanitizado, 502 classificado, nunca vaza token/stack)');
}

// ─── 7b. Posições (read-only): array/envelope, sessão, tool ausente, terminal desconectado, sanitização ─

const RAW_POSITION_FIXTURE = {
  ticket: 123456,
  time: 1700000000,
  time_msc: 1700000000123,
  time_update: 1700000500,
  time_update_msc: 1700000500456,
  type: 0,
  magic: 0,
  identifier: 123456,
  reason: 0,
  volume: 100,
  price_open: 10.5,
  sl: 0,
  tp: 0,
  price_current: 10.8,
  swap: 0,
  profit: 30,
  symbol: 'PETR4',
  comment: '',
  password: 'nunca deveria aparecer',
};

/** Tools de escrita/mutação de ordem — nunca deveriam aparecer em nenhum caminho de posições (read-only). */
const ORDER_MUTATION_TOOL_MARKERS = [
  'send_order',
  'order_send',
  'modify_order',
  'cancel_order',
  'close_position',
  'trade_send',
];

async function positionsTests(): Promise<void> {
  resetEnv();

  // Resposta como array puro.
  await withMockServer(
    { tools: [{ name: 'get_positions', result: async () => jsonTool([RAW_POSITION_FIXTURE]) }] },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      const positions = (await getPositions()) as Array<Record<string, unknown>>;
      assert.equal(positions.length, 1);
      assert.equal(positions[0].ticket, 123456);
      assert.equal(positions[0].password, '[REDACTED]', 'positions também passam pela redação genérica');

      resetEnv();
    }
  );

  // Resposta envelopada ({ positions: [...] }) — shape alternativo não documentado do build 6060.
  await withMockServer(
    { tools: [{ name: 'get_positions', result: async () => jsonTool({ positions: [RAW_POSITION_FIXTURE] }) }] },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      const positions = (await getPositions()) as Array<Record<string, unknown>>;
      assert.equal(positions.length, 1);
      assert.equal(positions[0].ticket, 123456);

      resetEnv();
    }
  );

  // Shape totalmente inesperado — nunca lança, só devolve lista vazia.
  await withMockServer(
    { tools: [{ name: 'get_positions', result: async () => jsonTool({ unexpected: 'shape' }) }] },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      assert.deepEqual(await getPositions(), []);

      resetEnv();
    }
  );

  // Falha de sessão (quirk build 6060) — recupera 1x via retry único do client.
  await withMockServer(
    {
      tools: [{ name: 'get_positions', result: async () => jsonTool([RAW_POSITION_FIXTURE]) }],
      failSessionChecksCount: 1,
    },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      const positions = (await getPositions()) as Array<Record<string, unknown>>;
      assert.equal(positions.length, 1);

      resetEnv();
    }
  );

  // Tool ausente no servidor nativo — falha isolada com MT5_MCP_TOOL_MISSING.
  await withMockServer(
    { tools: [{ name: 'some_unrelated_tool', result: async () => jsonTool({}) }] },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      await assert.rejects(
        getPositions(),
        (error: unknown) => error instanceof Mt5McpError && error.code === 'MT5_MCP_TOOL_MISSING'
      );

      resetEnv();
    }
  );

  // Terminal aberto mas sem conta logada — classificado como MT5_MCP_TERMINAL_DISCONNECTED, não erro genérico.
  await withMockServer(
    {
      tools: [
        {
          name: 'get_positions',
          result: async () => {
            throw new Error('No account is logged in');
          },
        },
      ],
    },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      await assert.rejects(
        getPositions(),
        (error: unknown) => error instanceof Mt5McpError && error.code === 'MT5_MCP_TERMINAL_DISCONNECTED'
      );

      resetEnv();
    }
  );

  console.log(
    'positions (capability, read-only): OK (array/envelope, sessão, tool ausente, terminal desconectado, redação)'
  );
}

// ─── 7c. Rota /api/mt5/mcp/positions ───────────────────────────────────────

async function positionsRouteTests(): Promise<void> {
  resetEnv();

  // Sem MT5_MCP_API_KEY: 503 fail-closed.
  const notConfiguredRes = await positionsGet(fakePositionsRequest('http://localhost/api/mt5/mcp/positions'));
  assert.equal(notConfiguredRes.status, 503);
  const notConfiguredBody = await notConfiguredRes.json();
  assert.equal(notConfiguredBody.error.code, 'MT5_MCP_NOT_CONFIGURED');

  await withMockServer(
    { tools: [{ name: 'get_positions', result: async () => jsonTool([RAW_POSITION_FIXTURE]) }] },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      const res = await positionsGet(fakePositionsRequest('http://localhost/api/mt5/mcp/positions'));
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.success, true);
      assert.equal(body.data.positions.length, 1);
      assert.equal(body.data.positions[0].ticket, 123456);
      assert.equal(body.data.positions[0].password, '[REDACTED]');

      const serialized = JSON.stringify(body);
      assert.ok(!serialized.includes(TOKEN), 'resposta de posições NUNCA deveria conter o Bearer');
      assert.ok(!serialized.toLowerCase().includes('authorization'), 'não deveria vazar o header usado internamente');
      for (const marker of ORDER_MUTATION_TOOL_MARKERS) {
        assert.ok(
          !serialized.toLowerCase().includes(marker),
          `rota de posições (read-only) nunca deveria mencionar "${marker}"`
        );
      }

      resetEnv();
    }
  );

  // symbol como query param chega até o tool call (?symbol=PETR4).
  await withMockServer(
    {
      tools: [
        {
          name: 'get_positions',
          result: async () => jsonTool([RAW_POSITION_FIXTURE]),
        },
      ],
    },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      const res = await positionsGet(fakePositionsRequest('http://localhost/api/mt5/mcp/positions?symbol=PETR4'));
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.data.positions.length, 1);

      resetEnv();
    }
  );

  // Terminal sem conta logada: rota propaga como erro classificado (502), nunca 200 nem stack/segredo.
  await withMockServer(
    {
      tools: [
        {
          name: 'get_positions',
          result: async () => {
            throw new Error('No account is logged in');
          },
        },
      ],
    },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      const res = await positionsGet(fakePositionsRequest('http://localhost/api/mt5/mcp/positions'));
      assert.equal(res.status, 502);
      const body = await res.json();
      assert.equal(body.success, false);
      assert.equal(body.error.code, 'MT5_MCP_TERMINAL_DISCONNECTED');
      assert.ok(
        !JSON.stringify(body).match(/stack|at\s+\w+\s+\(/i),
        'nunca deveria vazar stack trace, mesmo em erro classificado'
      );

      resetEnv();
    }
  );

  console.log(
    'rota /api/mt5/mcp/positions: OK (503 sem config, 200 sanitizado sem caminho de ordem, 502 terminal desconectado)'
  );
}

// ─── 7d. Tick (read-only): objeto direto/envelopado, sessão, tool ausente, terminal desconectado, sanitização ─

const RAW_TICK_FIXTURE = {
  symbol: 'PETR4',
  time: 1700000000,
  time_msc: 1700000000123,
  bid: 10.5,
  ask: 10.51,
  last: 10.5,
  volume: 100,
  volume_real: 100,
  flags: 0,
  volume_diff: 0,
  previous_close: 10.2,
  change: 0.3,
  change_percent: 2.94,
  password: 'nunca deveria aparecer',
};

async function tickTests(): Promise<void> {
  resetEnv();

  // Resposta como objeto direto.
  await withMockServer(
    { tools: [{ name: 'get_tick', result: async () => jsonTool(RAW_TICK_FIXTURE) }] },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      const tick = (await getTick('PETR4')) as Record<string, unknown>;
      assert.equal(tick.symbol, 'PETR4');
      assert.equal(tick.bid, 10.5);
      assert.equal(tick.password, '[REDACTED]', 'tick também passa pela redação genérica');

      resetEnv();
    }
  );

  // Resposta envelopada ({ tick: {...} }) — shape alternativo não documentado do build 6060.
  await withMockServer(
    { tools: [{ name: 'get_tick', result: async () => jsonTool({ tick: RAW_TICK_FIXTURE }) }] },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      const tick = (await getTick('PETR4')) as Record<string, unknown>;
      assert.equal(tick.symbol, 'PETR4');
      assert.equal(tick.bid, 10.5);

      resetEnv();
    }
  );

  // Falha de sessão (quirk build 6060) — recupera 1x via retry único do client.
  await withMockServer(
    {
      tools: [{ name: 'get_tick', result: async () => jsonTool(RAW_TICK_FIXTURE) }],
      failSessionChecksCount: 1,
    },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      const tick = (await getTick('PETR4')) as Record<string, unknown>;
      assert.equal(tick.symbol, 'PETR4');

      resetEnv();
    }
  );

  // Tool ausente no servidor nativo — falha isolada com MT5_MCP_TOOL_MISSING.
  await withMockServer(
    { tools: [{ name: 'some_unrelated_tool', result: async () => jsonTool({}) }] },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      await assert.rejects(
        getTick('PETR4'),
        (error: unknown) => error instanceof Mt5McpError && error.code === 'MT5_MCP_TOOL_MISSING'
      );

      resetEnv();
    }
  );

  // Terminal aberto mas sem conta logada — classificado como MT5_MCP_TERMINAL_DISCONNECTED, não erro genérico.
  await withMockServer(
    {
      tools: [
        {
          name: 'get_tick',
          result: async () => {
            throw new Error('No account is logged in');
          },
        },
      ],
    },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      await assert.rejects(
        getTick('PETR4'),
        (error: unknown) => error instanceof Mt5McpError && error.code === 'MT5_MCP_TERMINAL_DISCONNECTED'
      );

      resetEnv();
    }
  );

  console.log('tick (capability, read-only): OK (objeto direto/envelopado, sessão, tool ausente, terminal desconectado, redação)');
}

// ─── 7e. Rota /api/mt5/mcp/tick ────────────────────────────────────────────

async function tickRouteTests(): Promise<void> {
  resetEnv();

  // Sem MT5_MCP_API_KEY: 503 fail-closed.
  const notConfiguredRes = await tickGet(fakeTickRequest('http://localhost/api/mt5/mcp/tick?symbol=PETR4'));
  assert.equal(notConfiguredRes.status, 503);
  const notConfiguredBody = await notConfiguredRes.json();
  assert.equal(notConfiguredBody.error.code, 'MT5_MCP_NOT_CONFIGURED');

  // symbol ausente: 400 sem sequer consultar o MCP nativo (config presente, mas nunca chamada).
  process.env.MT5_MCP_API_KEY = TOKEN;
  const missingSymbolRes = await tickGet(fakeTickRequest('http://localhost/api/mt5/mcp/tick'));
  assert.equal(missingSymbolRes.status, 400);
  const missingSymbolBody = await missingSymbolRes.json();
  assert.equal(missingSymbolBody.success, false);
  resetEnv();

  await withMockServer(
    { tools: [{ name: 'get_tick', result: async () => jsonTool(RAW_TICK_FIXTURE) }] },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      const res = await tickGet(fakeTickRequest('http://localhost/api/mt5/mcp/tick?symbol=PETR4'));
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.success, true);
      assert.equal(body.data.symbol, 'PETR4');
      assert.equal(body.data.tick.bid, 10.5);
      assert.equal(body.data.tick.password, '[REDACTED]');

      const serialized = JSON.stringify(body);
      assert.ok(!serialized.includes(TOKEN), 'resposta de tick NUNCA deveria conter o Bearer');
      assert.ok(!serialized.toLowerCase().includes('authorization'), 'não deveria vazar o header usado internamente');
      for (const marker of ORDER_MUTATION_TOOL_MARKERS) {
        assert.ok(
          !serialized.toLowerCase().includes(marker),
          `rota de tick (read-only) nunca deveria mencionar "${marker}"`
        );
      }

      resetEnv();
    }
  );

  // Terminal sem conta logada: rota propaga como erro classificado (502), nunca 200 nem stack/segredo.
  await withMockServer(
    {
      tools: [
        {
          name: 'get_tick',
          result: async () => {
            throw new Error('No account is logged in');
          },
        },
      ],
    },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      const res = await tickGet(fakeTickRequest('http://localhost/api/mt5/mcp/tick?symbol=PETR4'));
      assert.equal(res.status, 502);
      const body = await res.json();
      assert.equal(body.success, false);
      assert.equal(body.error.code, 'MT5_MCP_TERMINAL_DISCONNECTED');
      assert.ok(
        !JSON.stringify(body).match(/stack|at\s+\w+\s+\(/i),
        'nunca deveria vazar stack trace, mesmo em erro classificado'
      );

      resetEnv();
    }
  );

  console.log('rota /api/mt5/mcp/tick: OK (503 sem config, 400 sem symbol, 200 sanitizado sem caminho de ordem, 502 terminal desconectado)');
}

// ─── 7f. Rates/candles (read-only): array/envelope, sessão, tool ausente, terminal desconectado, sanitização ─

const RAW_RATE_FIXTURE = {
  time: 1700000000,
  open: 10.4,
  high: 10.8,
  low: 10.3,
  close: 10.6,
  tick_volume: 1200,
  spread: 2,
  real_volume: 0,
  password: 'nunca deveria aparecer',
};

async function ratesTests(): Promise<void> {
  resetEnv();

  // Resposta como array puro.
  await withMockServer(
    { tools: [{ name: 'get_rates', result: async () => jsonTool([RAW_RATE_FIXTURE]) }] },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      const rates = (await getRates({ symbol: 'PETR4' })) as Array<Record<string, unknown>>;
      assert.equal(rates.length, 1);
      assert.equal(rates[0].close, 10.6);
      assert.equal(rates[0].password, '[REDACTED]', 'rates também passam pela redação genérica');

      resetEnv();
    }
  );

  // Resposta envelopada ({ candles: [...] }) — shape alternativo não documentado do build 6060.
  await withMockServer(
    { tools: [{ name: 'get_candles', result: async () => jsonTool({ candles: [RAW_RATE_FIXTURE] }) }] },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      const rates = (await getRates({ symbol: 'PETR4', timeframe: 'D1', count: 10 })) as Array<Record<string, unknown>>;
      assert.equal(rates.length, 1);
      assert.equal(rates[0].close, 10.6);

      resetEnv();
    }
  );

  // Shape totalmente inesperado — nunca lança, só devolve lista vazia.
  await withMockServer(
    { tools: [{ name: 'get_rates', result: async () => jsonTool({ unexpected: 'shape' }) }] },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      assert.deepEqual(await getRates({ symbol: 'PETR4' }), []);

      resetEnv();
    }
  );

  // Falha de sessão (quirk build 6060) — recupera 1x via retry único do client.
  await withMockServer(
    {
      tools: [{ name: 'get_rates', result: async () => jsonTool([RAW_RATE_FIXTURE]) }],
      failSessionChecksCount: 1,
    },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      const rates = (await getRates({ symbol: 'PETR4' })) as Array<Record<string, unknown>>;
      assert.equal(rates.length, 1);

      resetEnv();
    }
  );

  // Tool ausente no servidor nativo — falha isolada com MT5_MCP_TOOL_MISSING.
  await withMockServer(
    { tools: [{ name: 'some_unrelated_tool', result: async () => jsonTool({}) }] },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      await assert.rejects(
        getRates({ symbol: 'PETR4' }),
        (error: unknown) => error instanceof Mt5McpError && error.code === 'MT5_MCP_TOOL_MISSING'
      );

      resetEnv();
    }
  );

  // Terminal aberto mas sem conta logada — classificado como MT5_MCP_TERMINAL_DISCONNECTED, não erro genérico.
  await withMockServer(
    {
      tools: [
        {
          name: 'get_rates',
          result: async () => {
            throw new Error('No account is logged in');
          },
        },
      ],
    },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      await assert.rejects(
        getRates({ symbol: 'PETR4' }),
        (error: unknown) => error instanceof Mt5McpError && error.code === 'MT5_MCP_TERMINAL_DISCONNECTED'
      );

      resetEnv();
    }
  );

  console.log(
    'rates (capability, read-only): OK (array/envelope, sessão, tool ausente, terminal desconectado, redação)'
  );
}

// ─── 7g. Rota /api/mt5/mcp/rates ───────────────────────────────────────────

async function ratesRouteTests(): Promise<void> {
  resetEnv();

  // Sem MT5_MCP_API_KEY: 503 fail-closed.
  const notConfiguredRes = await ratesGet(fakeRatesRequest('http://localhost/api/mt5/mcp/rates?symbol=PETR4'));
  assert.equal(notConfiguredRes.status, 503);
  const notConfiguredBody = await notConfiguredRes.json();
  assert.equal(notConfiguredBody.error.code, 'MT5_MCP_NOT_CONFIGURED');

  // symbol ausente: 400 sem sequer consultar o MCP nativo (config presente, mas nunca chamada).
  process.env.MT5_MCP_API_KEY = TOKEN;
  const missingSymbolRes = await ratesGet(fakeRatesRequest('http://localhost/api/mt5/mcp/rates'));
  assert.equal(missingSymbolRes.status, 400);
  const missingSymbolBody = await missingSymbolRes.json();
  assert.equal(missingSymbolBody.success, false);
  resetEnv();

  await withMockServer(
    { tools: [{ name: 'get_rates', result: async () => jsonTool([RAW_RATE_FIXTURE]) }] },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      const res = await ratesGet(
        fakeRatesRequest('http://localhost/api/mt5/mcp/rates?symbol=PETR4&timeframe=D1&count=100&from=2024-01-01&to=2024-02-01')
      );
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.success, true);
      assert.equal(body.data.symbol, 'PETR4');
      assert.equal(body.data.rates.length, 1);
      assert.equal(body.data.rates[0].close, 10.6);
      assert.equal(body.data.rates[0].password, '[REDACTED]');

      const serialized = JSON.stringify(body);
      assert.ok(!serialized.includes(TOKEN), 'resposta de rates NUNCA deveria conter o Bearer');
      assert.ok(!serialized.toLowerCase().includes('authorization'), 'não deveria vazar o header usado internamente');
      for (const marker of ORDER_MUTATION_TOOL_MARKERS) {
        assert.ok(
          !serialized.toLowerCase().includes(marker),
          `rota de rates (read-only) nunca deveria mencionar "${marker}"`
        );
      }

      resetEnv();
    }
  );

  // Terminal sem conta logada: rota propaga como erro classificado (502), nunca 200 nem stack/segredo.
  await withMockServer(
    {
      tools: [
        {
          name: 'get_rates',
          result: async () => {
            throw new Error('No account is logged in');
          },
        },
      ],
    },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      const res = await ratesGet(fakeRatesRequest('http://localhost/api/mt5/mcp/rates?symbol=PETR4'));
      assert.equal(res.status, 502);
      const body = await res.json();
      assert.equal(body.success, false);
      assert.equal(body.error.code, 'MT5_MCP_TERMINAL_DISCONNECTED');
      assert.ok(
        !JSON.stringify(body).match(/stack|at\s+\w+\s+\(/i),
        'nunca deveria vazar stack trace, mesmo em erro classificado'
      );

      resetEnv();
    }
  );

  console.log(
    'rota /api/mt5/mcp/rates: OK (503 sem config, 400 sem symbol, 200 sanitizado sem caminho de ordem, 502 terminal desconectado)'
  );
}

// ─── 7h. Símbolos (read-only): array/envelope, sessão, tool ausente, terminal desconectado, sanitização ─

const RAW_SYMBOL_FIXTURE = {
  name: 'PETR4',
  description: 'Petrobras PN',
  visible: true,
  digits: 2,
  point: 0.01,
  password: 'nunca deveria aparecer',
};

async function symbolsTests(): Promise<void> {
  resetEnv();

  // Resposta como array puro.
  await withMockServer(
    { tools: [{ name: 'get_symbols', result: async () => jsonTool([RAW_SYMBOL_FIXTURE]) }] },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      const symbols = (await getSymbols()) as Array<Record<string, unknown>>;
      assert.equal(symbols.length, 1);
      assert.equal(symbols[0].name, 'PETR4');
      assert.equal(symbols[0].password, '[REDACTED]', 'symbols também passam pela redação genérica');

      resetEnv();
    }
  );

  // Resposta envelopada ({ symbols: [...] }) — shape alternativo não documentado do build 6060.
  await withMockServer(
    { tools: [{ name: 'symbols', result: async () => jsonTool({ symbols: [RAW_SYMBOL_FIXTURE] }) }] },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      const symbols = (await getSymbols()) as Array<Record<string, unknown>>;
      assert.equal(symbols.length, 1);
      assert.equal(symbols[0].name, 'PETR4');

      resetEnv();
    }
  );

  // Shape totalmente inesperado — nunca lança, só devolve lista vazia.
  await withMockServer(
    { tools: [{ name: 'get_symbols', result: async () => jsonTool({ unexpected: 'shape' }) }] },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      assert.deepEqual(await getSymbols(), []);

      resetEnv();
    }
  );

  // Falha de sessão (quirk build 6060) — recupera 1x via retry único do client.
  await withMockServer(
    {
      tools: [{ name: 'get_symbols', result: async () => jsonTool([RAW_SYMBOL_FIXTURE]) }],
      failSessionChecksCount: 1,
    },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      const symbols = (await getSymbols()) as Array<Record<string, unknown>>;
      assert.equal(symbols.length, 1);

      resetEnv();
    }
  );

  // Tool ausente no servidor nativo — falha isolada com MT5_MCP_TOOL_MISSING.
  await withMockServer(
    { tools: [{ name: 'some_unrelated_tool', result: async () => jsonTool({}) }] },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      await assert.rejects(
        getSymbols(),
        (error: unknown) => error instanceof Mt5McpError && error.code === 'MT5_MCP_TOOL_MISSING'
      );

      resetEnv();
    }
  );

  // Terminal aberto mas sem conta logada — classificado como MT5_MCP_TERMINAL_DISCONNECTED, não erro genérico.
  await withMockServer(
    {
      tools: [
        {
          name: 'get_symbols',
          result: async () => {
            throw new Error('No account is logged in');
          },
        },
      ],
    },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      await assert.rejects(
        getSymbols(),
        (error: unknown) => error instanceof Mt5McpError && error.code === 'MT5_MCP_TERMINAL_DISCONNECTED'
      );

      resetEnv();
    }
  );

  console.log(
    'symbols (capability, read-only): OK (array/envelope, sessão, tool ausente, terminal desconectado, redação)'
  );
}

// ─── 7i. Rota /api/mt5/mcp/symbols ─────────────────────────────────────────

async function symbolsRouteTests(): Promise<void> {
  resetEnv();

  // Sem MT5_MCP_API_KEY: 503 fail-closed.
  const notConfiguredRes = await symbolsGet();
  assert.equal(notConfiguredRes.status, 503);
  const notConfiguredBody = await notConfiguredRes.json();
  assert.equal(notConfiguredBody.error.code, 'MT5_MCP_NOT_CONFIGURED');

  await withMockServer(
    { tools: [{ name: 'get_symbols', result: async () => jsonTool([RAW_SYMBOL_FIXTURE]) }] },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      const res = await symbolsGet();
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.success, true);
      assert.equal(body.data.symbols.length, 1);
      assert.equal(body.data.symbols[0].name, 'PETR4');
      assert.equal(body.data.symbols[0].password, '[REDACTED]');

      const serialized = JSON.stringify(body);
      assert.ok(!serialized.includes(TOKEN), 'resposta de symbols NUNCA deveria conter o Bearer');
      assert.ok(!serialized.toLowerCase().includes('authorization'), 'não deveria vazar o header usado internamente');
      for (const marker of ORDER_MUTATION_TOOL_MARKERS) {
        assert.ok(
          !serialized.toLowerCase().includes(marker),
          `rota de symbols (read-only) nunca deveria mencionar "${marker}"`
        );
      }

      resetEnv();
    }
  );

  // Terminal sem conta logada: rota propaga como erro classificado (502), nunca 200 nem stack/segredo.
  await withMockServer(
    {
      tools: [
        {
          name: 'get_symbols',
          result: async () => {
            throw new Error('No account is logged in');
          },
        },
      ],
    },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      const res = await symbolsGet();
      assert.equal(res.status, 502);
      const body = await res.json();
      assert.equal(body.success, false);
      assert.equal(body.error.code, 'MT5_MCP_TERMINAL_DISCONNECTED');
      assert.ok(
        !JSON.stringify(body).match(/stack|at\s+\w+\s+\(/i),
        'nunca deveria vazar stack trace, mesmo em erro classificado'
      );

      resetEnv();
    }
  );

  console.log('rota /api/mt5/mcp/symbols: OK (503 sem config, 200 sanitizado sem caminho de ordem, 502 terminal desconectado)');
}

// ─── 7j. Histórico de deals (read-only): array/envelope, sessão, tool ausente, terminal desconectado, sanitização ─

const RAW_DEAL_FIXTURE = {
  ticket: 987654,
  order: 111222,
  time: 1700000000,
  time_msc: 1700000000123,
  type: 0,
  entry: 1,
  magic: 0,
  reason: 0,
  position_id: 123456,
  volume: 100,
  price: 10.55,
  profit: 25,
  commission: -1.5,
  swap: 0,
  symbol: 'PETR4',
  comment: '',
  password: 'nunca deveria aparecer',
};

async function historyTests(): Promise<void> {
  resetEnv();

  // Resposta como array puro.
  await withMockServer(
    { tools: [{ name: 'get_history_deals', result: async () => jsonTool([RAW_DEAL_FIXTURE]) }] },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      const deals = (await getHistoryDeals()) as Array<Record<string, unknown>>;
      assert.equal(deals.length, 1);
      assert.equal(deals[0].ticket, 987654);
      assert.equal(deals[0].password, '[REDACTED]', 'deals também passam pela redação genérica');

      resetEnv();
    }
  );

  // Resposta envelopada ({ deals: [...] }) — shape alternativo não documentado do build 6060.
  await withMockServer(
    { tools: [{ name: 'get_history', result: async () => jsonTool({ deals: [RAW_DEAL_FIXTURE] }) }] },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      const deals = (await getHistoryDeals({ from: '2024-01-01', to: '2024-02-01', symbol: 'PETR4' })) as Array<
        Record<string, unknown>
      >;
      assert.equal(deals.length, 1);
      assert.equal(deals[0].ticket, 987654);

      resetEnv();
    }
  );

  // Shape totalmente inesperado — nunca lança, só devolve lista vazia.
  await withMockServer(
    { tools: [{ name: 'get_history_deals', result: async () => jsonTool({ unexpected: 'shape' }) }] },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      assert.deepEqual(await getHistoryDeals(), []);

      resetEnv();
    }
  );

  // Falha de sessão (quirk build 6060) — recupera 1x via retry único do client.
  await withMockServer(
    {
      tools: [{ name: 'get_history_deals', result: async () => jsonTool([RAW_DEAL_FIXTURE]) }],
      failSessionChecksCount: 1,
    },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      const deals = (await getHistoryDeals()) as Array<Record<string, unknown>>;
      assert.equal(deals.length, 1);

      resetEnv();
    }
  );

  // Tool ausente no servidor nativo — falha isolada com MT5_MCP_TOOL_MISSING.
  await withMockServer(
    { tools: [{ name: 'some_unrelated_tool', result: async () => jsonTool({}) }] },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      await assert.rejects(
        getHistoryDeals(),
        (error: unknown) => error instanceof Mt5McpError && error.code === 'MT5_MCP_TOOL_MISSING'
      );

      resetEnv();
    }
  );

  // Terminal aberto mas sem conta logada — classificado como MT5_MCP_TERMINAL_DISCONNECTED, não erro genérico.
  await withMockServer(
    {
      tools: [
        {
          name: 'get_history_deals',
          result: async () => {
            throw new Error('No account is logged in');
          },
        },
      ],
    },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      await assert.rejects(
        getHistoryDeals(),
        (error: unknown) => error instanceof Mt5McpError && error.code === 'MT5_MCP_TERMINAL_DISCONNECTED'
      );

      resetEnv();
    }
  );

  console.log(
    'history/deals (capability, read-only): OK (array/envelope, sessão, tool ausente, terminal desconectado, redação)'
  );
}

// ─── 7k. Rota /api/mt5/mcp/history ─────────────────────────────────────────

async function historyRouteTests(): Promise<void> {
  resetEnv();

  // Sem MT5_MCP_API_KEY: 503 fail-closed.
  const notConfiguredRes = await historyGet(fakeHistoryRequest('http://localhost/api/mt5/mcp/history'));
  assert.equal(notConfiguredRes.status, 503);
  const notConfiguredBody = await notConfiguredRes.json();
  assert.equal(notConfiguredBody.error.code, 'MT5_MCP_NOT_CONFIGURED');

  await withMockServer(
    { tools: [{ name: 'get_history_deals', result: async () => jsonTool([RAW_DEAL_FIXTURE]) }] },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      const res = await historyGet(
        fakeHistoryRequest('http://localhost/api/mt5/mcp/history?from=2024-01-01&to=2024-02-01&symbol=PETR4')
      );
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.success, true);
      assert.equal(body.data.deals.length, 1);
      assert.equal(body.data.deals[0].ticket, 987654);
      assert.equal(body.data.deals[0].password, '[REDACTED]');

      const serialized = JSON.stringify(body);
      assert.ok(!serialized.includes(TOKEN), 'resposta de history NUNCA deveria conter o Bearer');
      assert.ok(!serialized.toLowerCase().includes('authorization'), 'não deveria vazar o header usado internamente');
      for (const marker of ORDER_MUTATION_TOOL_MARKERS) {
        assert.ok(
          !serialized.toLowerCase().includes(marker),
          `rota de history (read-only) nunca deveria mencionar "${marker}"`
        );
      }

      resetEnv();
    }
  );

  // Terminal sem conta logada: rota propaga como erro classificado (502), nunca 200 nem stack/segredo.
  await withMockServer(
    {
      tools: [
        {
          name: 'get_history_deals',
          result: async () => {
            throw new Error('No account is logged in');
          },
        },
      ],
    },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      const res = await historyGet(fakeHistoryRequest('http://localhost/api/mt5/mcp/history'));
      assert.equal(res.status, 502);
      const body = await res.json();
      assert.equal(body.success, false);
      assert.equal(body.error.code, 'MT5_MCP_TERMINAL_DISCONNECTED');
      assert.ok(
        !JSON.stringify(body).match(/stack|at\s+\w+\s+\(/i),
        'nunca deveria vazar stack trace, mesmo em erro classificado'
      );

      resetEnv();
    }
  );

  console.log(
    'rota /api/mt5/mcp/history: OK (503 sem config, 200 sanitizado sem caminho de ordem, 502 terminal desconectado)'
  );
}

// ─── 7l. Ordens abertas (read-only): array/envelope, sessão, tool ausente, terminal desconectado, sanitização ─

const RAW_ORDER_FIXTURE = {
  ticket: 555111,
  time_setup: 1700000000,
  time_setup_msc: 1700000000123,
  time_done: 0,
  type: 2,
  state: 1,
  volume: 100,
  volume_initial: 100,
  volume_current: 100,
  price_open: 10.4,
  price_current: 10.5,
  sl: 0,
  tp: 0,
  magic: 0,
  reason: 0,
  symbol: 'PETR4',
  comment: '',
  password: 'nunca deveria aparecer',
};

async function ordersTests(): Promise<void> {
  resetEnv();

  // Resposta como array puro.
  await withMockServer(
    { tools: [{ name: 'get_positions', result: async () => jsonTool([RAW_ORDER_FIXTURE]) }] },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      const orders = (await getOrders()) as Array<Record<string, unknown>>;
      assert.equal(orders.length, 1);
      assert.equal(orders[0].ticket, 555111);
      assert.equal(orders[0].password, '[REDACTED]', 'orders também passam pela redação genérica');

      resetEnv();
    }
  );

  // Resposta envelopada ({ orders: [...] }) — shape alternativo não documentado do build 6060.
  await withMockServer(
    { tools: [{ name: 'get_trading_open_positions', result: async () => jsonTool({ orders: [RAW_ORDER_FIXTURE] }) }] },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      const orders = (await getOrders('PETR4')) as Array<Record<string, unknown>>;
      assert.equal(orders.length, 1);
      assert.equal(orders[0].ticket, 555111);

      resetEnv();
    }
  );

  // Shape totalmente inesperado — nunca lança, só devolve lista vazia.
  await withMockServer(
    { tools: [{ name: 'get_positions', result: async () => jsonTool({ unexpected: 'shape' }) }] },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      assert.deepEqual(await getOrders(), []);

      resetEnv();
    }
  );

  // Falha de sessão (quirk build 6060) — recupera 1x via retry único do client.
  await withMockServer(
    {
      tools: [{ name: 'get_positions', result: async () => jsonTool([RAW_ORDER_FIXTURE]) }],
      failSessionChecksCount: 1,
    },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      const orders = (await getOrders()) as Array<Record<string, unknown>>;
      assert.equal(orders.length, 1);

      resetEnv();
    }
  );

  // Tool ausente no servidor nativo — falha isolada com MT5_MCP_TOOL_MISSING.
  await withMockServer(
    { tools: [{ name: 'some_unrelated_tool', result: async () => jsonTool({}) }] },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      await assert.rejects(
        getOrders(),
        (error: unknown) => error instanceof Mt5McpError && error.code === 'MT5_MCP_TOOL_MISSING'
      );

      resetEnv();
    }
  );

  // Terminal aberto mas sem conta logada — classificado como MT5_MCP_TERMINAL_DISCONNECTED, não erro genérico.
  await withMockServer(
    {
      tools: [
        {
          name: 'get_positions',
          result: async () => {
            throw new Error('No account is logged in');
          },
        },
      ],
    },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      await assert.rejects(
        getOrders(),
        (error: unknown) => error instanceof Mt5McpError && error.code === 'MT5_MCP_TERMINAL_DISCONNECTED'
      );

      resetEnv();
    }
  );

  console.log(
    'orders (capability, read-only): OK (array/envelope, sessão, tool ausente, terminal desconectado, redação)'
  );
}

// ─── 7m. Rota /api/mt5/mcp/orders ──────────────────────────────────────────

async function ordersRouteTests(): Promise<void> {
  resetEnv();

  // Sem MT5_MCP_API_KEY: 503 fail-closed.
  const notConfiguredRes = await ordersGet(fakeOrdersRequest('http://localhost/api/mt5/mcp/orders'));
  assert.equal(notConfiguredRes.status, 503);
  const notConfiguredBody = await notConfiguredRes.json();
  assert.equal(notConfiguredBody.error.code, 'MT5_MCP_NOT_CONFIGURED');

  await withMockServer(
    { tools: [{ name: 'get_positions', result: async () => jsonTool([RAW_ORDER_FIXTURE]) }] },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      const res = await ordersGet(fakeOrdersRequest('http://localhost/api/mt5/mcp/orders?symbol=PETR4'));
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.success, true);
      assert.equal(body.data.orders.length, 1);
      assert.equal(body.data.orders[0].ticket, 555111);
      assert.equal(body.data.orders[0].password, '[REDACTED]');

      const serialized = JSON.stringify(body);
      assert.ok(!serialized.includes(TOKEN), 'resposta de orders NUNCA deveria conter o Bearer');
      assert.ok(!serialized.toLowerCase().includes('authorization'), 'não deveria vazar o header usado internamente');
      for (const marker of ORDER_MUTATION_TOOL_MARKERS) {
        assert.ok(
          !serialized.toLowerCase().includes(marker),
          `rota de orders (read-only) nunca deveria mencionar "${marker}"`
        );
      }

      resetEnv();
    }
  );

  // Terminal sem conta logada: rota propaga como erro classificado (502), nunca 200 nem stack/segredo.
  await withMockServer(
    {
      tools: [
        {
          name: 'get_positions',
          result: async () => {
            throw new Error('No account is logged in');
          },
        },
      ],
    },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      const res = await ordersGet(fakeOrdersRequest('http://localhost/api/mt5/mcp/orders'));
      assert.equal(res.status, 502);
      const body = await res.json();
      assert.equal(body.success, false);
      assert.equal(body.error.code, 'MT5_MCP_TERMINAL_DISCONNECTED');
      assert.ok(
        !JSON.stringify(body).match(/stack|at\s+\w+\s+\(/i),
        'nunca deveria vazar stack trace, mesmo em erro classificado'
      );

      resetEnv();
    }
  );

  console.log(
    'rota /api/mt5/mcp/orders: OK (503 sem config, 200 sanitizado sem caminho de ordem, 502 terminal desconectado)'
  );
}

// ─── 7n. Info de símbolo (read-only): objeto direto/envelopado, sessão, tool ausente, terminal desconectado, sanitização ─

const RAW_SYMBOL_INFO_FIXTURE = {
  symbol: 'PETR4',
  bid: 10.5,
  ask: 10.51,
  last: 10.5,
  digits: 2,
  point: 0.01,
  visible: true,
  password: 'nunca deveria aparecer',
};

async function symbolInfoTests(): Promise<void> {
  resetEnv();

  // Resposta como objeto direto.
  await withMockServer(
    { tools: [{ name: 'get_symbol_info', result: async () => jsonTool(RAW_SYMBOL_INFO_FIXTURE) }] },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      const info = (await getSymbolInfo('PETR4')) as Record<string, unknown>;
      assert.equal(info.symbol, 'PETR4');
      assert.equal(info.bid, 10.5);
      assert.equal(info.password, '[REDACTED]', 'symbol_info também passa pela redação genérica');

      resetEnv();
    }
  );

  // Resposta envelopada ({ symbol_info: {...} }) — shape alternativo não documentado do build 6060.
  await withMockServer(
    { tools: [{ name: 'symbol_info', result: async () => jsonTool({ symbol_info: RAW_SYMBOL_INFO_FIXTURE }) }] },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      const info = (await getSymbolInfo('PETR4')) as Record<string, unknown>;
      assert.equal(info.symbol, 'PETR4');
      assert.equal(info.bid, 10.5);

      resetEnv();
    }
  );

  // Falha de sessão (quirk build 6060) — recupera 1x via retry único do client.
  await withMockServer(
    {
      tools: [{ name: 'get_symbol_info', result: async () => jsonTool(RAW_SYMBOL_INFO_FIXTURE) }],
      failSessionChecksCount: 1,
    },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      const info = (await getSymbolInfo('PETR4')) as Record<string, unknown>;
      assert.equal(info.symbol, 'PETR4');

      resetEnv();
    }
  );

  // Tool ausente no servidor nativo — falha isolada com MT5_MCP_TOOL_MISSING.
  await withMockServer(
    { tools: [{ name: 'some_unrelated_tool', result: async () => jsonTool({}) }] },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      await assert.rejects(
        getSymbolInfo('PETR4'),
        (error: unknown) => error instanceof Mt5McpError && error.code === 'MT5_MCP_TOOL_MISSING'
      );

      resetEnv();
    }
  );

  // Terminal aberto mas sem conta logada — classificado como MT5_MCP_TERMINAL_DISCONNECTED, não erro genérico.
  await withMockServer(
    {
      tools: [
        {
          name: 'get_symbol_info',
          result: async () => {
            throw new Error('No account is logged in');
          },
        },
      ],
    },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      await assert.rejects(
        getSymbolInfo('PETR4'),
        (error: unknown) => error instanceof Mt5McpError && error.code === 'MT5_MCP_TERMINAL_DISCONNECTED'
      );

      resetEnv();
    }
  );

  console.log(
    'symbol_info (capability, read-only): OK (objeto direto/envelopado, sessão, tool ausente, terminal desconectado, redação)'
  );
}

// ─── 7o. Rota /api/mt5/mcp/symbol-info ─────────────────────────────────────

async function symbolInfoRouteTests(): Promise<void> {
  resetEnv();

  // Sem MT5_MCP_API_KEY: 503 fail-closed.
  const notConfiguredRes = await symbolInfoGet(fakeSymbolInfoRequest('http://localhost/api/mt5/mcp/symbol-info?symbol=PETR4'));
  assert.equal(notConfiguredRes.status, 503);
  const notConfiguredBody = await notConfiguredRes.json();
  assert.equal(notConfiguredBody.error.code, 'MT5_MCP_NOT_CONFIGURED');

  // symbol ausente: 400 sem sequer consultar o MCP nativo (config presente, mas nunca chamada).
  process.env.MT5_MCP_API_KEY = TOKEN;
  const missingSymbolRes = await symbolInfoGet(fakeSymbolInfoRequest('http://localhost/api/mt5/mcp/symbol-info'));
  assert.equal(missingSymbolRes.status, 400);
  const missingSymbolBody = await missingSymbolRes.json();
  assert.equal(missingSymbolBody.success, false);
  resetEnv();

  await withMockServer(
    { tools: [{ name: 'get_symbol_info', result: async () => jsonTool(RAW_SYMBOL_INFO_FIXTURE) }] },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      const res = await symbolInfoGet(fakeSymbolInfoRequest('http://localhost/api/mt5/mcp/symbol-info?symbol=PETR4'));
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.success, true);
      assert.equal(body.data.symbol, 'PETR4');
      assert.equal(body.data.symbolInfo.bid, 10.5);
      assert.equal(body.data.symbolInfo.password, '[REDACTED]');

      const serialized = JSON.stringify(body);
      assert.ok(!serialized.includes(TOKEN), 'resposta de symbol-info NUNCA deveria conter o Bearer');
      assert.ok(!serialized.toLowerCase().includes('authorization'), 'não deveria vazar o header usado internamente');
      for (const marker of ORDER_MUTATION_TOOL_MARKERS) {
        assert.ok(
          !serialized.toLowerCase().includes(marker),
          `rota de symbol-info (read-only) nunca deveria mencionar "${marker}"`
        );
      }

      resetEnv();
    }
  );

  // Terminal sem conta logada: rota propaga como erro classificado (502), nunca 200 nem stack/segredo.
  await withMockServer(
    {
      tools: [
        {
          name: 'get_symbol_info',
          result: async () => {
            throw new Error('No account is logged in');
          },
        },
      ],
    },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      const res = await symbolInfoGet(fakeSymbolInfoRequest('http://localhost/api/mt5/mcp/symbol-info?symbol=PETR4'));
      assert.equal(res.status, 502);
      const body = await res.json();
      assert.equal(body.success, false);
      assert.equal(body.error.code, 'MT5_MCP_TERMINAL_DISCONNECTED');
      assert.ok(
        !JSON.stringify(body).match(/stack|at\s+\w+\s+\(/i),
        'nunca deveria vazar stack trace, mesmo em erro classificado'
      );

      resetEnv();
    }
  );

  console.log(
    'rota /api/mt5/mcp/symbol-info: OK (503 sem config, 400 sem symbol, 200 sanitizado sem caminho de ordem, 502 terminal desconectado)'
  );
}

// ─── 8. Filtro de equities B3 (função pura, extraída de mt5Service) ────────

function equitiesFilterTests(): void {
  const symbols = [
    { name: 'PETR4', path: 'BOVESPA\\A VISTA\\PETR4' },
    { name: 'VALE3', path: 'BOVESPA\\A VISTA\\VALE3' },
    { name: 'PETR3F', path: 'BOVESPA\\A VISTA\\PETR3F' }, // sufixo excluído (F)
    { name: 'ABCDEFG', path: 'BOVESPA\\A VISTA\\ABCDEFG' }, // > 6 caracteres
    { name: 'EURUSD', path: 'Forex\\Majors\\EURUSD' }, // path fora de BOVESPA\A VISTA
    { name: 'NOPATH' }, // sem path — deve ser excluído, não incluído por engano
  ];

  const equities = filterB3EquityNames(symbols);
  assert.deepEqual(equities, ['PETR4', 'VALE3'], 'deveria incluir só ações B3 válidas, ordenadas');

  const noPath = [{ name: 'PETR4' }, { name: 'VALE3' }];
  assert.deepEqual(filterB3EquityNames(noPath), [], 'sem path em nenhum símbolo, deveria degradar para lista vazia');

  assert.deepEqual(filterB3EquityNames([]), []);

  console.log('filtro de equities B3 (função pura): OK (path/sufixo/tamanho, degradação segura sem path)');
}

// ─── 9. Consumer real getEquities()/fetchEquitiesFromSymbols() (mock de fetch global) ──

async function equitiesConsumerTests(): Promise<void> {
  const originalFetch = global.fetch;
  const service = new MT5Service();

  try {
    // Caso 1: sucesso — GET /api/mt5/mcp/symbols retorna symbols; evento 'equities' com shape exato.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        service.off('equities', onEquities);
        reject(new Error("timeout esperando evento 'equities'"));
      }, 2000);
      const onEquities = (data: unknown) => {
        clearTimeout(timer);
        service.off('equities', onEquities);
        try {
          assert.deepEqual(data, { equities: ['PETR4', 'VALE3'] }, 'evento equities deveria ter o shape exato esperado');
          resolve();
        } catch (err) {
          reject(err);
        }
      };
      (global as any).fetch = async (url: string) => {
        assert.ok(String(url).includes('/api/mt5/mcp/symbols'), 'getEquities deveria consultar /api/mt5/mcp/symbols');
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: {
              symbols: [
                { name: 'PETR4', path: 'BOVESPA\\A VISTA\\PETR4' },
                { name: 'VALE3', path: 'BOVESPA\\A VISTA\\VALE3' },
                { name: 'PETR3F', path: 'BOVESPA\\A VISTA\\PETR3F' },
              ],
            },
          }),
        };
      };
      service.on('equities', onEquities);
      service.getEquities();
    });

    // Caso 2: falha de rede (fetch rejeita) — deveria emitir 'error' com type:'equities', nunca lançar/travar.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        service.off('error', onError);
        reject(new Error("timeout esperando evento 'error' (falha de rede)"));
      }, 2000);
      const onError = (data: any) => {
        if (data?.type !== 'equities') return;
        clearTimeout(timer);
        service.off('error', onError);
        try {
          assert.ok(typeof data.message === 'string' && data.message.length > 0, 'erro deveria ter mensagem acionável');
          resolve();
        } catch (err) {
          reject(err);
        }
      };
      (global as any).fetch = async () => {
        throw new Error('network down');
      };
      service.on('error', onError);
      service.getEquities();
    });

    // Caso 3: HTTP ok mas body.success=false — deveria emitir 'error' sanitizado com type:'equities'.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        service.off('error', onError);
        reject(new Error("timeout esperando evento 'error' (HTTP/body de erro)"));
      }, 2000);
      const onError = (data: any) => {
        if (data?.type !== 'equities') return;
        clearTimeout(timer);
        service.off('error', onError);
        try {
          assert.equal(data.message, 'falha simulada', 'mensagem de erro sanitizada deveria vir do body.error.message');
          resolve();
        } catch (err) {
          reject(err);
        }
      };
      (global as any).fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ success: false, error: { code: 'MT5_MCP_TOOL_ERROR', message: 'falha simulada' } }),
      });
      service.on('error', onError);
      service.getEquities();
    });
  } finally {
    (global as any).fetch = originalFetch;
  }

  console.log(
    'consumer getEquities()/fetchEquitiesFromSymbols() (fetch mockado): OK (sucesso, falha de rede, HTTP/body de erro)'
  );
}

// ─── 10. Book de ofertas (read-only): objeto direto/envelopado, sessão, tool ausente, terminal desconectado, sanitização ─

const RAW_BOOK_SPLIT_FIXTURE = {
  symbol: 'PETR4',
  bids: [{ price: 10.5, volume: 100 }],
  asks: [{ price: 10.51, volume: 200 }],
  digits: 2,
  password: 'nunca deveria aparecer',
};

async function orderBookTests(): Promise<void> {
  resetEnv();

  // Resposta como objeto já separado ({bids,asks}) direto.
  await withMockServer(
    { tools: [{ name: 'get_market_book', result: async () => jsonTool(RAW_BOOK_SPLIT_FIXTURE) }] },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      const book = (await getMarketBook('PETR4')) as Record<string, unknown>;
      assert.deepEqual(book.bids, [{ price: 10.5, volume: 100 }]);
      assert.deepEqual(book.asks, [{ price: 10.51, volume: 200 }]);
      assert.equal(book.password, '[REDACTED]', 'market_book também passa pela redação genérica');

      resetEnv();
    }
  );

  // Resposta envelopada ({ book: {...} }) — shape alternativo não documentado do build 6060.
  await withMockServer(
    { tools: [{ name: 'get_depth', result: async () => jsonTool({ book: RAW_BOOK_SPLIT_FIXTURE }) }] },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      const book = (await getMarketBook('PETR4')) as Record<string, unknown>;
      assert.deepEqual(book.bids, [{ price: 10.5, volume: 100 }]);

      resetEnv();
    }
  );

  // Falha de sessão (quirk build 6060) — recupera 1x via retry único do client.
  await withMockServer(
    {
      tools: [{ name: 'get_market_book', result: async () => jsonTool(RAW_BOOK_SPLIT_FIXTURE) }],
      failSessionChecksCount: 1,
    },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      const book = (await getMarketBook('PETR4')) as Record<string, unknown>;
      assert.ok(Array.isArray(book.bids));

      resetEnv();
    }
  );

  // Tool ausente no servidor nativo — falha isolada com MT5_MCP_TOOL_MISSING.
  await withMockServer(
    { tools: [{ name: 'some_unrelated_tool', result: async () => jsonTool({}) }] },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      await assert.rejects(
        getMarketBook('PETR4'),
        (error: unknown) => error instanceof Mt5McpError && error.code === 'MT5_MCP_TOOL_MISSING'
      );

      resetEnv();
    }
  );

  // Terminal aberto mas sem conta logada — classificado como MT5_MCP_TERMINAL_DISCONNECTED, não erro genérico.
  await withMockServer(
    {
      tools: [
        {
          name: 'get_market_book',
          result: async () => {
            throw new Error('No account is logged in');
          },
        },
      ],
    },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      await assert.rejects(
        getMarketBook('PETR4'),
        (error: unknown) => error instanceof Mt5McpError && error.code === 'MT5_MCP_TERMINAL_DISCONNECTED'
      );

      resetEnv();
    }
  );

  console.log(
    'market_book (capability, read-only): OK (objeto direto/envelopado, sessão, tool ausente, terminal desconectado, redação)'
  );
}

// ─── 11. Rota /api/mt5/mcp/order-book ──────────────────────────────────────

async function orderBookRouteTests(): Promise<void> {
  resetEnv();

  // Sem MT5_MCP_API_KEY: 503 fail-closed.
  const notConfiguredRes = await orderBookGet(fakeOrderBookRequest('http://localhost/api/mt5/mcp/order-book?symbol=PETR4'));
  assert.equal(notConfiguredRes.status, 503);
  const notConfiguredBody = await notConfiguredRes.json();
  assert.equal(notConfiguredBody.error.code, 'MT5_MCP_NOT_CONFIGURED');

  // symbol ausente: 400 sem sequer consultar o MCP nativo.
  process.env.MT5_MCP_API_KEY = TOKEN;
  const missingSymbolRes = await orderBookGet(fakeOrderBookRequest('http://localhost/api/mt5/mcp/order-book'));
  assert.equal(missingSymbolRes.status, 400);
  const missingSymbolBody = await missingSymbolRes.json();
  assert.equal(missingSymbolBody.success, false);
  resetEnv();

  await withMockServer(
    { tools: [{ name: 'get_market_book', result: async () => jsonTool(RAW_BOOK_SPLIT_FIXTURE) }] },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      const res = await orderBookGet(fakeOrderBookRequest('http://localhost/api/mt5/mcp/order-book?symbol=PETR4'));
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.success, true);
      assert.equal(body.data.symbol, 'PETR4');
      assert.deepEqual(body.data.book.bids, [{ price: 10.5, volume: 100 }]);
      assert.equal(body.data.book.password, '[REDACTED]');

      const serialized = JSON.stringify(body);
      assert.ok(!serialized.includes(TOKEN), 'resposta de order-book NUNCA deveria conter o Bearer');
      assert.ok(!serialized.toLowerCase().includes('authorization'), 'não deveria vazar o header usado internamente');
      for (const marker of ORDER_MUTATION_TOOL_MARKERS) {
        assert.ok(
          !serialized.toLowerCase().includes(marker),
          `rota de order-book (read-only) nunca deveria mencionar "${marker}"`
        );
      }

      resetEnv();
    }
  );

  // Terminal sem conta logada: rota propaga como erro classificado (502), nunca 200 nem stack/segredo.
  await withMockServer(
    {
      tools: [
        {
          name: 'get_market_book',
          result: async () => {
            throw new Error('No account is logged in');
          },
        },
      ],
    },
    async (handle) => {
      process.env.MT5_MCP_ENDPOINT = handle.url;
      process.env.MT5_MCP_API_KEY = TOKEN;

      const res = await orderBookGet(fakeOrderBookRequest('http://localhost/api/mt5/mcp/order-book?symbol=PETR4'));
      assert.equal(res.status, 502);
      const body = await res.json();
      assert.equal(body.success, false);
      assert.equal(body.error.code, 'MT5_MCP_TERMINAL_DISCONNECTED');
      assert.ok(
        !JSON.stringify(body).match(/stack|at\s+\w+\s+\(/i),
        'nunca deveria vazar stack trace, mesmo em erro classificado'
      );

      resetEnv();
    }
  );

  console.log(
    'rota /api/mt5/mcp/order-book: OK (503 sem config, 400 sem symbol, 200 sanitizado sem caminho de ordem, 502 terminal desconectado)'
  );
}

// ─── 12. Consumer real getOrderBook() one-shot (mock de fetch global) ─────

async function orderBookConsumerOneShotTests(): Promise<void> {
  const originalFetch = global.fetch;
  const service = new MT5Service();
  const originalSend = service.send.bind(service);
  service.send = () => {
    throw new Error('não deveria chamar send() legado (WS) — getOrderBook migrado para fetch read-only');
  };

  try {
    // Caso 1: sucesso, shape array plana com campo `type` — cobre os 4 valores numéricos reais do
    // MQL (BOOK_TYPE_SELL=1/ask, BOOK_TYPE_BUY=2/bid, BOOK_TYPE_SELL_MARKET=3/ask,
    // BOOK_TYPE_BUY_MARKET=4/bid), variantes string relevantes, e tipos desconhecidos (devem ser
    // ignorados, nunca aparecer em bids nem em asks).
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        service.off('orderbook', onBook);
        reject(new Error("timeout esperando evento 'orderbook' (array plana)"));
      }, 2000);
      const onBook = (data: unknown) => {
        clearTimeout(timer);
        service.off('orderbook', onBook);
        try {
          assert.deepEqual(
            data,
            {
              symbol: 'PETR4',
              bids: [
                { price: 10.5, volume: 100 },
                { price: 10.49, volume: 300 },
                { price: 10.48, volume: 400 },
              ],
              asks: [
                { price: 10.51, volume: 50 },
                { price: 10.52, volume: 150 },
                { price: 10.53, volume: 250 },
              ],
            },
            'evento orderbook deveria classificar corretamente SELL=1/3 como ask, BUY=2/4 como bid, strings equivalentes, e ignorar tipos desconhecidos'
          );
          resolve();
        } catch (err) {
          reject(err);
        }
      };
      (global as any).fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            symbol: 'PETR4',
            book: [
              { type: 2, price: 10.5, volume: 100 },
              { type: 1, price: 10.51, volume: 50 },
              { type: 4, price: 10.49, volume: 300 },
              { type: 3, price: 10.52, volume: 150 },
              { type: 'BUY', price: 10.48, volume: 400 },
              { type: 'BOOK_TYPE_SELL_MARKET', price: 10.53, volume: 250 },
              { type: 'UNKNOWN_TYPE_99', price: 999, volume: 999 },
              { type: 0, price: 888, volume: 888 },
            ],
          },
        }),
      });
      service.on('orderbook', onBook);
      service.getOrderBook('PETR4');
    });

    // Caso 2: sucesso, shape já {bids,asks} — passthrough direto.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        service.off('orderbook', onBook);
        reject(new Error("timeout esperando evento 'orderbook' (já separado)"));
      }, 2000);
      const onBook = (data: unknown) => {
        clearTimeout(timer);
        service.off('orderbook', onBook);
        try {
          assert.deepEqual(data, {
            symbol: 'PETR4',
            bids: [{ price: 10.5, volume: 100 }],
            asks: [{ price: 10.51, volume: 200 }],
            digits: 2,
          });
          resolve();
        } catch (err) {
          reject(err);
        }
      };
      (global as any).fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { symbol: 'PETR4', book: RAW_BOOK_SPLIT_FIXTURE } }),
      });
      service.on('orderbook', onBook);
      service.getOrderBook('PETR4');
    });

    // Caso 3: falha de rede — emite 'error' com type:'orderBook'.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        service.off('error', onError);
        reject(new Error("timeout esperando evento 'error' (falha de rede)"));
      }, 2000);
      const onError = (data: any) => {
        if (data?.type !== 'orderBook') return;
        clearTimeout(timer);
        service.off('error', onError);
        try {
          assert.ok(typeof data.message === 'string' && data.message.length > 0);
          resolve();
        } catch (err) {
          reject(err);
        }
      };
      (global as any).fetch = async () => {
        throw new Error('network down');
      };
      service.on('error', onError);
      service.getOrderBook('PETR4');
    });

    // Caso 4: HTTP ok mas body.success=false — emite 'error' sanitizado com type:'orderBook'.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        service.off('error', onError);
        reject(new Error("timeout esperando evento 'error' (HTTP/body de erro)"));
      }, 2000);
      const onError = (data: any) => {
        if (data?.type !== 'orderBook') return;
        clearTimeout(timer);
        service.off('error', onError);
        try {
          assert.equal(data.message, 'falha simulada');
          resolve();
        } catch (err) {
          reject(err);
        }
      };
      (global as any).fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ success: false, error: { code: 'MT5_MCP_TOOL_ERROR', message: 'falha simulada' } }),
      });
      service.on('error', onError);
      service.getOrderBook('PETR4');
    });
  } finally {
    (global as any).fetch = originalFetch;
    service.send = originalSend;
  }

  console.log(
    'consumer getOrderBook() one-shot (fetch mockado): OK (array plana, já separado, falha de rede, HTTP/body de erro, zero send() WS)'
  );
}

/** Fake local de setInterval/clearInterval — só para os testes de polling abaixo; nunca usado em produção. */
function installFakeInterval(): {
  fireAll: () => void;
  activeCount: () => number;
  restore: () => void;
} {
  const originalSetInterval = global.setInterval;
  const originalClearInterval = global.clearInterval;
  const registry = new Map<number, () => void>();
  let nextId = 1;
  (global as any).setInterval = (fn: () => void, _ms?: number) => {
    const id = nextId++;
    registry.set(id, fn);
    return id as unknown as NodeJS.Timeout;
  };
  (global as any).clearInterval = (id: unknown) => {
    registry.delete(id as number);
  };
  return {
    fireAll: () => {
      for (const fn of Array.from(registry.values())) fn();
    },
    activeCount: () => registry.size,
    restore: () => {
      global.setInterval = originalSetInterval;
      global.clearInterval = originalClearInterval;
    },
  };
}

// ─── 13. Consumer real subscribeOrderBook/unsubscribeOrderBook/disconnect (polling, dedupe, no-overlap) ─

async function orderBookPollingConsumerTests(): Promise<void> {
  const originalFetch = global.fetch;
  const fakeInterval = installFakeInterval();
  const service = new MT5Service();
  const originalSend = service.send.bind(service);
  service.send = () => {
    throw new Error('não deveria chamar send() legado (WS) — subscribeOrderBook migrado para polling read-only');
  };

  try {
    let fetchCallCount = 0;
    (global as any).fetch = async () => {
      fetchCallCount++;
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { symbol: 'PETR4', book: RAW_BOOK_SPLIT_FIXTURE } }),
      };
    };

    // subscribe: fetch imediato, um timer ativo.
    service.subscribeOrderBook('PETR4');
    await new Promise((r) => setImmediate(r));
    assert.equal(fetchCallCount, 1, 'subscribeOrderBook deveria disparar fetch imediato');
    assert.equal(fakeInterval.activeCount(), 1, 'subscribeOrderBook deveria registrar exatamente 1 timer');

    // dedupe: segunda inscrição do mesmo símbolo não cria novo timer nem novo fetch imediato.
    service.subscribeOrderBook('PETR4');
    await new Promise((r) => setImmediate(r));
    assert.equal(fetchCallCount, 1, 'inscrição duplicada não deveria disparar fetch extra');
    assert.equal(fakeInterval.activeCount(), 1, 'inscrição duplicada não deveria criar timer extra');

    // polling repetido: cada fireAll() dispara um novo fetch.
    fakeInterval.fireAll();
    await new Promise((r) => setImmediate(r));
    assert.equal(fetchCallCount, 2, 'cada disparo do timer deveria chamar fetch novamente');
    fakeInterval.fireAll();
    await new Promise((r) => setImmediate(r));
    assert.equal(fetchCallCount, 3, 'polling deveria continuar a cada disparo');

    // no-overlap: fetch lento — dois disparos consecutivos do timer não devem sobrepor chamadas.
    let resolveSlowFetch: (() => void) | undefined;
    let slowFetchCallCount = 0;
    (global as any).fetch = async () => {
      slowFetchCallCount++;
      await new Promise<void>((r) => {
        resolveSlowFetch = r;
      });
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { symbol: 'PETR4', book: RAW_BOOK_SPLIT_FIXTURE } }),
      };
    };
    fakeInterval.fireAll(); // dispara fetch lento nº1, ainda pendente
    await new Promise((r) => setImmediate(r));
    fakeInterval.fireAll(); // deveria ser ignorado — fetch anterior ainda em andamento
    await new Promise((r) => setImmediate(r));
    assert.equal(slowFetchCallCount, 1, 'fetch sobreposto deveria ser ignorado enquanto o anterior está em andamento');
    resolveSlowFetch?.();
    await new Promise((r) => setImmediate(r));

    // unsubscribe cancela: nenhum fetch novo após desinscrever, mesmo disparando o timer manualmente.
    (global as any).fetch = async () => {
      fetchCallCount++;
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { symbol: 'PETR4', book: RAW_BOOK_SPLIT_FIXTURE } }),
      };
    };
    const countBeforeUnsubscribe = fetchCallCount;
    service.unsubscribeOrderBook('PETR4');
    assert.equal(fakeInterval.activeCount(), 0, 'unsubscribeOrderBook deveria remover o timer');
    fakeInterval.fireAll(); // não deveria fazer nada — nenhum timer registrado
    await new Promise((r) => setImmediate(r));
    assert.equal(fetchCallCount, countBeforeUnsubscribe, 'unsubscribeOrderBook deveria parar o polling');

    // disconnect limpa tudo: inscrever 2 símbolos, desconectar, disparar timers remanescentes não deveria existir.
    service.subscribeOrderBook('PETR4');
    service.subscribeOrderBook('VALE3');
    await new Promise((r) => setImmediate(r));
    assert.equal(fakeInterval.activeCount(), 2, 'dois símbolos inscritos deveriam ter 2 timers');
    const countBeforeDisconnect = fetchCallCount;
    service.disconnect();
    assert.equal(fakeInterval.activeCount(), 0, 'disconnect() deveria limpar todos os timers de order-book');
    fakeInterval.fireAll(); // não deveria fazer nada — todos os timers já foram removidos
    await new Promise((r) => setImmediate(r));
    assert.equal(fetchCallCount, countBeforeDisconnect, 'disconnect() deveria impedir qualquer polling remanescente');
  } finally {
    (global as any).fetch = originalFetch;
    service.send = originalSend;
    fakeInterval.restore();
  }

  console.log(
    'consumer subscribeOrderBook/unsubscribeOrderBook/disconnect (polling, fake timers): OK (fetch imediato, dedupe, no-overlap, polling repetido, unsubscribe cancela, disconnect limpa tudo, zero send() WS)'
  );
}

// ─── 14. Política de erro do polling de order-book: permanente cancela, transitório continua ─

async function orderBookErrorPolicyTests(): Promise<void> {
  const originalFetch = global.fetch;
  const fakeInterval = installFakeInterval();
  const service = new MT5Service();
  const originalSend = service.send.bind(service);
  service.send = () => {
    throw new Error('não deveria chamar send() legado (WS)');
  };

  try {
    // Caso 1: erro permanente (MT5_MCP_TOOL_MISSING) — emite 'error' e CANCELA o polling.
    let fetchCallCount = 0;
    let sawPermanentError = false;
    (global as any).fetch = async () => {
      fetchCallCount++;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: false,
          error: { code: 'MT5_MCP_TOOL_MISSING', message: 'market_book não disponível' },
        }),
      };
    };
    const onPermanentError = (data: any) => {
      if (data?.type === 'orderBook' && data?.symbol === 'PETR4') sawPermanentError = true;
    };
    service.on('error', onPermanentError);
    service.subscribeOrderBook('PETR4');
    await new Promise((r) => setImmediate(r));
    assert.ok(sawPermanentError, 'erro permanente deveria emitir evento error');
    assert.equal(fetchCallCount, 1);
    fakeInterval.fireAll();
    await new Promise((r) => setImmediate(r));
    fakeInterval.fireAll();
    await new Promise((r) => setImmediate(r));
    assert.equal(
      fetchCallCount,
      1,
      'erro permanente deveria cancelar o polling — nenhum fetch adicional mesmo após avançar o timer'
    );
    assert.equal(fakeInterval.activeCount(), 0, 'erro permanente deveria remover o timer (unsubscribe automático)');
    service.off('error', onPermanentError);

    // Caso 2: erro transitório (MT5_MCP_UNREACHABLE) — emite 'error' mas CONTINUA o polling.
    let transientFetchCallCount = 0;
    let sawTransientError = false;
    (global as any).fetch = async () => {
      transientFetchCallCount++;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: false,
          error: { code: 'MT5_MCP_UNREACHABLE', message: 'terminal indisponível' },
        }),
      };
    };
    const onTransientError = (data: any) => {
      if (data?.type === 'orderBook' && data?.symbol === 'VALE3') sawTransientError = true;
    };
    service.on('error', onTransientError);
    service.subscribeOrderBook('VALE3');
    await new Promise((r) => setImmediate(r));
    assert.ok(sawTransientError, 'erro transitório deveria emitir evento error');
    assert.equal(transientFetchCallCount, 1);
    assert.equal(fakeInterval.activeCount(), 1, 'erro transitório NÃO deveria remover o timer');
    fakeInterval.fireAll();
    await new Promise((r) => setImmediate(r));
    assert.equal(transientFetchCallCount, 2, 'erro transitório deveria continuar o polling normalmente');
    service.off('error', onTransientError);
    service.unsubscribeOrderBook('VALE3');
  } finally {
    (global as any).fetch = originalFetch;
    service.send = originalSend;
    fakeInterval.restore();
  }

  console.log(
    'política de erro do polling de order-book: OK (erro permanente cancela polling; erro transitório continua; zero WS)'
  );
}

// ─── 15. Precedência de classifyUnknownError: mensagens reais do SDK ───────

function classifyUnknownErrorPrecedenceTests(): void {
  const schemaMessages = [
    "Tool get_workspace_info has an output schema but did not return structured content",
    "Structured content does not match the tool output schema",
    "Failed to validate structured content",
  ];
  for (const message of schemaMessages) {
    const result = __classifyUnknownErrorForTests(new Error(message));
    assert.equal(result.code, 'MT5_MCP_TOOL_ERROR', `deveria classificar como MT5_MCP_TOOL_ERROR: "${message}"`);
  }
  assert.equal(
    __classifyUnknownErrorForTests(new Error('MCP error -32602: Invalid params')).code,
    'MT5_MCP_TOOL_ERROR',
    'código JSON-RPC -32602 deveria classificar como MT5_MCP_TOOL_ERROR'
  );

  // auth/session/terminal continuam prioritários mesmo quando o texto também menciona schema/structured content.
  assert.equal(
    __classifyUnknownErrorForTests(new Error('401 unauthorized — structured content rejected')).code,
    'MT5_MCP_AUTH_FAILED',
    'auth deveria ter precedência sobre schema'
  );
  assert.equal(
    __classifyUnknownErrorForTests(new Error('session not initialized — output schema mismatch')).code,
    'MT5_MCP_SESSION_ERROR',
    'sessão deveria ter precedência sobre schema'
  );
  assert.equal(
    __classifyUnknownErrorForTests(new Error('no account is logged in — structured content invalid')).code,
    'MT5_MCP_TERMINAL_DISCONNECTED',
    'terminal desconectado deveria ter precedência sobre schema'
  );

  // Fallback: mensagem desconhecida que não casa com nenhum padrão — MT5_MCP_UNREACHABLE.
  assert.equal(
    __classifyUnknownErrorForTests(new Error('ECONNREFUSED 127.0.0.1:22346')).code,
    'MT5_MCP_UNREACHABLE',
    'mensagem não reconhecida deveria cair no fallback MT5_MCP_UNREACHABLE'
  );

  console.log(
    'precedência de classifyUnknownError: OK (mensagens reais do SDK + -32602 => TOOL_ERROR; auth/session/terminal prioritários; fallback desconhecido => UNREACHABLE)'
  );
}

// ─── main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await configTests();
  await handshakeAndWorkspaceInfoTests();
  await accountInfoTests();
  await tradingEligibilityTests();
  redactionTests();
  await sessionErrorRetryTests();
  await toolMissingTests();
  await unreachableAndAuthTests();
  classifyUnknownErrorPrecedenceTests();
  await statusRouteTests();
  await positionsTests();
  await positionsRouteTests();
  await tickTests();
  await tickRouteTests();
  await ratesTests();
  await ratesRouteTests();
  await symbolsTests();
  await symbolsRouteTests();
  await historyTests();
  await historyRouteTests();
  await ordersTests();
  await ordersRouteTests();
  await symbolInfoTests();
  await symbolInfoRouteTests();
  equitiesFilterTests();
  await equitiesConsumerTests();
  await orderBookTests();
  await orderBookRouteTests();
  await orderBookConsumerOneShotTests();
  await orderBookPollingConsumerTests();
  await orderBookErrorPolicyTests();

  console.log('Fundação MT5 MCP nativo (Fase 1) — TODOS OS TESTES PASSARAM');
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
