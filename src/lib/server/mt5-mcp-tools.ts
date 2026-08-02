/**
 * Mapeamento tolerante de capabilities → tool names reais do MT5 MCP nativo
 * — WR Trading Pro
 *
 * Os nomes de tool do servidor nativo não são confirmados publicamente (o
 * próprio Hermes registra a descoberta como "ainda sendo explorada" na
 * primeira versão do build 6060). Em vez de fixar um nome e quebrar se a
 * versão real usar outro, cada capability tem uma lista de candidatos —
 * `resolveMt5ToolName` chama `tools/list` (uma vez por processo, cacheado) e
 * usa o primeiro candidato que existir de fato. Se nenhum candidato bater,
 * a capability falha isoladamente com MT5_MCP_TOOL_MISSING — as demais
 * continuam funcionando normalmente.
 */

import { callMt5Tool, listMt5Tools, Mt5McpError, type Mt5McpToolResult } from './mt5-mcp-client';

export type Mt5McpCapability =
  | 'workspace_info'
  | 'account_info'
  | 'positions'
  | 'orders'
  | 'history'
  | 'symbols'
  | 'symbol_info'
  | 'rates'
  | 'tick'
  | 'market_book'
  | 'ensure_symbol_watch'
  | 'order_send_market'
  | 'order_send_pending'
  | 'order_modify_sltp'
  | 'order_delete_pending'
  | 'position_close_single'
  | 'position_close_by';

/**
 * Candidatos por capability, em ordem de preferência. Os nomes reais foram
 * verificados por sonda direta (`tools/list`) contra o servidor MCP nativo
 * do MT5 (build 6060+) instalado — não são mais um palpite. Ficam registrados
 * aqui também os candidatos "de convenção comum" antigos como fallback, caso
 * uma versão futura do servidor use nomes diferentes.
 *
 * GAPS confirmados nesta versão real (sem tool candidata — a capability
 * falha isolada com MT5_MCP_TOOL_MISSING, nunca finge sucesso):
 * - `orders` (ordens pendentes/abertas): não existe tool dedicada. O mais
 *   próximo é `get_trading_open_positions` com `include_orders: true`, mas
 *   isso devolve posições+ordens no mesmo payload — não um endpoint próprio
 *   de "orders". Não mapeado aqui de propósito, para não fabricar semântica.
 * - `symbol_info`: nenhuma tool expõe info de UM símbolo isolado.
 * - `market_book` (livro de ofertas/DOM): nenhuma tool equivalente.
 * - `tick` (cotação atual): não existe "get current tick" — só
 *   `get_chart_ticks_history` (histórico, exige `datetime_from`/`datetime_to`).
 *   Não mapeado aqui: a capability atual chama só com `{symbol}`, incompatível
 *   com o schema real (params obrigatórios diferentes). Pendência registrada.
 *
 * `rates` (`get_chart_history`) e `history` (`get_trading_history_*`) TÊM
 * tool real, mas com schema de argumentos diferente do que este módulo envia
 * hoje (`period`+`datetime_from`+`datetime_to` em vez de `timeframe`+`count`).
 * Mapeados aqui para não regredir a listagem de tools, mas as funções
 * `getRates`/`getHistoryDeals` ainda precisam de ajuste de argumentos — ver
 * pendência no handoff.
 */
const TOOL_NAME_CANDIDATES: Record<Mt5McpCapability, readonly string[]> = {
  workspace_info: ['get_workspace_info', 'workspace_info'],
  account_info: ['get_trading_account_info', 'get_account_info', 'account_info', 'get_account'],
  positions: ['get_trading_open_positions', 'get_positions', 'positions', 'list_positions'],
  orders: ['get_orders', 'orders', 'list_orders', 'get_open_orders'],
  history: ['get_trading_history_positions', 'get_history_deals', 'get_history', 'history_deals', 'get_deals_history'],
  symbols: ['get_marketwatch_symbols', 'get_symbols', 'symbols', 'list_symbols'],
  symbol_info: ['get_symbol_info', 'symbol_info'],
  rates: ['get_chart_history', 'get_rates', 'get_candles', 'copy_rates', 'get_bars'],
  tick: ['get_chart_ticks_history', 'get_tick', 'get_symbol_price', 'get_last_tick', 'symbol_info_tick'],
  market_book: ['get_market_book', 'get_depth', 'market_book_get', 'get_order_book'],
  ensure_symbol_watch: ['add_marketwatch_symbol'],
  // Tools de trade (verificadas por sonda real em 2026-08-02) — cada uma exige
  // "symbol" como checagem de segurança do próprio servidor, além dos campos
  // específicos da ação. additionalProperties:false no schema real — nunca
  // enviar campo além do documentado.
  order_send_market: ['trade_send_market_order'],
  order_send_pending: ['trade_send_pending_order'],
  order_modify_sltp: ['trade_modify_sl_tp'],
  order_delete_pending: ['trade_delete_order'],
  position_close_single: ['trade_close_single_position'],
  position_close_by: ['trade_close_by_position'],
};

/** Cache de tools descobertas — válido pela vida do processo; nomes de tool não mudam entre sessões. */
let discoveredToolNames: Set<string> | null = null;

async function getDiscoveredToolNames(): Promise<Set<string>> {
  if (discoveredToolNames) return discoveredToolNames;
  const tools = await listMt5Tools();
  discoveredToolNames = new Set(tools.map((t) => t.name));
  return discoveredToolNames;
}

/** Exposto só para os testes — nunca chamado em código de produção. */
export function __resetMt5McpToolCacheForTests(): void {
  discoveredToolNames = null;
}

export async function resolveMt5ToolName(capability: Mt5McpCapability): Promise<string> {
  const names = await getDiscoveredToolNames();
  const candidate = TOOL_NAME_CANDIDATES[capability].find((name) => names.has(name));
  if (!candidate) {
    throw new Mt5McpError(
      'MT5_MCP_TOOL_MISSING',
      `MT5 MCP nativo não expõe nenhuma tool esperada para "${capability}" (candidatos: ${TOOL_NAME_CANDIDATES[capability].join(', ')}).`
    );
  }
  return candidate;
}

const SENSITIVE_KEY_PATTERN = /password|token|secret|api[_-]?key|bearer|authorization/i;
const MAX_REDACT_DEPTH = 6;

/**
 * Redação genérica e recursiva por nome de campo — defesa em profundidade
 * caso o payload do MT5 nativo inclua, sem documentação, algum campo
 * sensível. Nunca confiar apenas nisso para dados que sabidamente carregam
 * segredo (esses nunca devem nem chegar aqui).
 */
export function redactSensitiveFields(value: unknown, depth = 0): unknown {
  if (depth > MAX_REDACT_DEPTH || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redactSensitiveFields(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY_PATTERN.test(key) ? '[REDACTED]' : redactSensitiveFields(val, depth + 1);
  }
  return out;
}

/** structuredContent tem prioridade; senão tenta JSON.parse do primeiro bloco de texto; senão devolve o texto puro. */
function extractToolValue(result: Mt5McpToolResult): unknown {
  if (result.structuredContent) return result.structuredContent;
  const text = result.content.find((c) => c.type === 'text' && typeof c.text === 'string')?.text;
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Chamada de pre-flight obrigatória do MT5 MCP nativo — a documentação do
 * servidor exige `get_workspace_info` antes de qualquer outro acesso a
 * tool/arquivo. Usada pela rota de status (Fase 1) para provar handshake +
 * sessão funcionais.
 */
export async function getWorkspaceInfo(): Promise<unknown> {
  const toolName = await resolveMt5ToolName('workspace_info');
  const result = await callMt5Tool(toolName, {});
  return redactSensitiveFields(extractToolValue(result));
}

/**
 * `get_trading_account_info` (verificado por sonda real) devolve
 * `{ account: {...}, terminal: {...} }`, não um objeto achatado — e não
 * expõe todos os campos de `MT5AccountInfo` (ex.: leverage, marginLevel).
 * Achata os campos de `account` (snake_case → alguns aliases camelCase
 * usados pela UI) e deriva `tradeAllowed` de dois flags do terminal
 * (`experts_trade_allowed` E `mcp_trade_allowed` — os dois precisam estar
 * true; qualquer um false já impede envio de ordem no terminal real).
 */
function normalizeAccountInfoPayload(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  const account = obj.account && typeof obj.account === 'object' ? (obj.account as Record<string, unknown>) : null;
  if (!account) return obj; // já achatado — tolerância a outra versão do servidor
  const terminal = obj.terminal && typeof obj.terminal === 'object' ? (obj.terminal as Record<string, unknown>) : {};
  return {
    ...account,
    marginFree: account.margin_free,
    tradeAllowed: Boolean(terminal.experts_trade_allowed) && Boolean(terminal.mcp_trade_allowed),
  };
}

/**
 * Info da conta logada no terminal (via GUI do próprio MT5 — nunca por
 * login/senha vindos do WR). Se o terminal estiver aberto mas sem conta
 * logada, o client já classifica isso como MT5_MCP_TERMINAL_DISCONNECTED
 * (ver isTerminalDisconnectedMessage em mt5-mcp-client.ts) — o chamador
 * decide se trata como erro fatal ou estado "conectado sem conta".
 */
export async function getAccountInfo(): Promise<unknown> {
  const toolName = await resolveMt5ToolName('account_info');
  const result = await callMt5Tool(toolName, {});
  return normalizeAccountInfoPayload(redactSensitiveFields(extractToolValue(result)));
}

export interface Mt5TradingEligibility {
  readonly tradeAllowed: boolean;
  readonly reason?: string;
}

/** Nomes de campo tolerados em account_info para "trading permitido" — o
 * schema exato do build 6060 não é documentado publicamente (mesma
 * ressalva de TOOL_NAME_CANDIDATES), então checa as variações mais
 * prováveis em vez de fixar uma única chave. */
const TRADE_ALLOWED_FIELD_CANDIDATES = [
  'tradeAllowed',
  'trade_allowed',
  'tradeExpert',
  'trade_expert',
  'isTradeAllowed',
] as const;

/**
 * Gate de leitura da conta (AutoTrading/permissão) usado por duas coisas:
 * (1) a UI para desabilitar o botão de ordem quando o terminal não permite
 * trading; (2) as rotas de execução (`/api/mt5/mcp/order/*`), que chamam
 * `assertTradingEligible()` abaixo ANTES de qualquer tool de trade — nunca
 * enviam ordem sem essa checagem passar primeiro. Deriva exclusivamente de
 * account_info, nunca de estado local/cache.
 */
export async function getTradingEligibility(): Promise<Mt5TradingEligibility> {
  const info = (await getAccountInfo()) as Record<string, unknown> | null;
  if (!info || typeof info !== 'object') {
    return { tradeAllowed: false, reason: 'account_info não retornou dados utilizáveis' };
  }
  const matchedField = TRADE_ALLOWED_FIELD_CANDIDATES.find((field) => field in info);
  if (!matchedField) {
    return {
      tradeAllowed: false,
      reason: 'account_info não expõe nenhum campo conhecido de permissão de trading',
    };
  }
  const tradeAllowed = Boolean(info[matchedField]);
  return tradeAllowed
    ? { tradeAllowed: true }
    : { tradeAllowed: false, reason: 'Trading desabilitado no terminal ou na conta (AutoTrading/permissão da conta)' };
}

/** Lança `MT5_MCP_TRADING_NOT_ALLOWED` se a conta/terminal não permitir trading — chamado por TODA rota de execução antes de qualquer tool de trade. */
export async function assertTradingEligible(): Promise<void> {
  const eligibility = await getTradingEligibility();
  if (!eligibility.tradeAllowed) {
    throw new Mt5McpError(
      'MT5_MCP_TRADING_NOT_ALLOWED',
      eligibility.reason || 'Trading não permitido pelo terminal/conta MT5 no momento.'
    );
  }
}

/**
 * Posições abertas (read-only) — via capability `positions` já registrada em
 * TOOL_NAME_CANDIDATES. O shape de retorno do build 6060 não é documentado
 * (array puro ou `{ positions: [...] }`); normalizePositionsPayload tolera
 * as duas formas só para esta capability, sem generalizar para outras.
 */
function normalizePositionsPayload(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && Array.isArray((value as Record<string, unknown>).positions)) {
    return (value as Record<string, unknown>).positions as unknown[];
  }
  return [];
}

export async function getPositions(symbol?: string): Promise<unknown[]> {
  const toolName = await resolveMt5ToolName('positions');
  const args: Record<string, unknown> = {};
  if (symbol) args.symbol = symbol;
  const result = await callMt5Tool(toolName, args);
  const redacted = redactSensitiveFields(extractToolValue(result));
  return normalizePositionsPayload(redacted);
}

/** Tick de um símbolo não vem documentado como shape fixo — pode ser o objeto direto ou envelopado sob 'tick'/'result'. */
function normalizeTickPayload(value: unknown): unknown {
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if ('tick' in obj) return obj.tick;
    if ('result' in obj && typeof obj.result === 'object') return obj.result;
  }
  return value;
}

/**
 * `get_chart_history`/`get_chart_ticks_history` falham com "symbol not
 * found" se o símbolo não estiver no Market Watch do terminal (verificado
 * por sonda real: os watchlists padrão do app, ex. PETR4/VALE3/BBDC4, não
 * vêm pré-adicionados). `add_marketwatch_symbol` só afeta VISIBILIDADE no
 * Market Watch — nunca abre posição/ordem (garantido pela própria descrição
 * da tool). Best-effort: se a capability não existir ou falhar, ignora — a
 * chamada de dados seguinte reporta o erro real por conta própria.
 */
async function ensureSymbolInMarketWatch(symbol: string): Promise<void> {
  try {
    const toolName = await resolveMt5ToolName('ensure_symbol_watch');
    await callMt5Tool(toolName, { symbol, show: true });
  } catch {
    // Melhor esforço — capability ausente ou falha aqui não deve impedir a tentativa de dados.
  }
}

/**
 * Este servidor real não tem "get current tick" — só `get_chart_ticks_history`
 * (`datetime_from`/`datetime_to`/`symbol` obrigatórios). Pede os últimos 5
 * minutos e devolve o tick mais recente do array — aproximação declarada,
 * não um tick "ao vivo" garantido (pode ter alguns segundos de atraso e pode
 * vir vazio fora do pregão).
 */
export async function getTick(symbol: string): Promise<unknown> {
  await ensureSymbolInMarketWatch(symbol);
  const toolName = await resolveMt5ToolName('tick');
  const now = new Date();
  const from = new Date(now.getTime() - 5 * 60_000);
  const result = await callMt5Tool(toolName, {
    symbol,
    datetime_from: from.toISOString(),
    datetime_to: now.toISOString(),
    limit: 1000,
  });
  const redacted = redactSensitiveFields(extractToolValue(result));
  const ticks = normalizeRatesPayload(redacted); // mesmo formato de envelope (array/'ticks'/'result')
  return ticks.length > 0 ? ticks[ticks.length - 1] : normalizeTickPayload(redacted);
}

/**
 * Rates (candles OHLCV) não vêm com shape documentado — pode ser array puro
 * ou envelopado sob 'rates'/'candles'/'bars'/'result'. Tolera as formas mais
 * prováveis, só para esta capability.
 */
function normalizeRatesPayload(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    for (const key of ['rates', 'candles', 'bars', 'ticks', 'history', 'result'] as const) {
      const candidate = (value as Record<string, unknown>)[key];
      if (Array.isArray(candidate)) return candidate;
    }
  }
  return [];
}

export interface Mt5RatesParams {
  readonly symbol: string;
  readonly timeframe?: string;
  readonly count?: number;
  readonly from?: string;
  readonly to?: string;
}

/** Minutos por período — só os períodos aceitos pelo schema real de `get_chart_history`. */
const PERIOD_MINUTES: Record<string, number> = {
  M1: 1, M2: 2, M3: 3, M4: 4, M5: 5, M6: 6, M10: 10, M12: 12, M15: 15, M20: 20, M30: 30,
  H1: 60, H2: 120, H3: 180, H4: 240, H6: 360, H8: 480, H12: 720,
  D1: 1440, W1: 10080, MN1: 43200,
};

/**
 * `timeframe` chega em formatos inconsistentes de chamadores diferentes do
 * app (ex.: '1H', 'H1', '1D', 'D1', '5M', 'M5') — nenhum é o nome exato que
 * `get_chart_history` aceita. Normaliza dígito+letra para letra+dígito
 * (ex.: '1H' → 'H1') e default 'H1' se vazio/desconhecido.
 */
function normalizePeriod(timeframe: string | undefined): string {
  if (!timeframe) return 'H1';
  const upper = timeframe.trim().toUpperCase();
  if (upper in PERIOD_MINUTES) return upper;
  const match = /^(\d+)([A-Z]+)$/.exec(upper);
  if (match) {
    const swapped = `${match[2]}${match[1]}`;
    if (swapped in PERIOD_MINUTES) return swapped;
  }
  return 'H1';
}

/**
 * `get_chart_history` (verificado por sonda real) exige `datetime_from`,
 * `datetime_to`, `symbol`, `period` — não aceita `count`/`timeframe` como
 * os chamadores deste módulo enviam. Traduz: `timeframe` → `period`
 * (normalizado); se `from`/`to` não vierem prontos, calcula uma janela de
 * `count` barras (default 300) a partir de agora, usando a duração do
 * período.
 */
export async function getRates(params: Mt5RatesParams): Promise<unknown[]> {
  await ensureSymbolInMarketWatch(params.symbol);
  const toolName = await resolveMt5ToolName('rates');
  const period = normalizePeriod(params.timeframe);
  let datetimeFrom = params.from;
  let datetimeTo = params.to;
  if (!datetimeFrom || !datetimeTo) {
    const count = typeof params.count === 'number' && params.count > 0 ? params.count : 300;
    const minutes = PERIOD_MINUTES[period] ?? 60;
    const to = new Date();
    const from = new Date(to.getTime() - count * minutes * 60_000);
    datetimeFrom = from.toISOString();
    datetimeTo = to.toISOString();
  }
  const args: Record<string, unknown> = {
    symbol: params.symbol,
    period,
    datetime_from: datetimeFrom,
    datetime_to: datetimeTo,
  };
  if (typeof params.count === 'number') args.limit = params.count;
  const result = await callMt5Tool(toolName, args);
  const redacted = redactSensitiveFields(extractToolValue(result));
  return normalizeRatesPayload(redacted).map(normalizeMt5CandleTime);
}

/**
 * O `time` de cada candle vem no formato MT5 `"YYYY.MM.DD HH:MM:SS"`
 * (verificado por sonda real) — `new Date(...)` do JS NÃO faz parse disso
 * (retorna Invalid Date). Converte para epoch em segundos aqui, no servidor,
 * para que `mt5Service.normalizeMcpCandle` (que já espera epoch ou algo que
 * `new Date()` entenda) funcione sem precisar conhecer o formato do MT5.
 */
function normalizeMt5CandleTime(candle: unknown): unknown {
  if (!candle || typeof candle !== 'object') return candle;
  const obj = candle as Record<string, unknown>;
  const time = obj.time;
  if (typeof time !== 'string') return candle;
  const match = /^(\d{4})\.(\d{2})\.(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(time);
  if (!match) return candle;
  const [, y, mo, d, h, mi, s] = match;
  const epochSeconds = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)) / 1000;
  return { ...obj, time: epochSeconds };
}

/** Lista de símbolos não vem com shape documentado — pode ser array puro ou envelopado sob 'symbols'/'result'. */
function normalizeSymbolsPayload(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    for (const key of ['symbols', 'result'] as const) {
      const candidate = (value as Record<string, unknown>)[key];
      if (Array.isArray(candidate)) return candidate;
    }
  }
  return [];
}

export async function getSymbols(): Promise<unknown[]> {
  const toolName = await resolveMt5ToolName('symbols');
  const result = await callMt5Tool(toolName, {});
  const redacted = redactSensitiveFields(extractToolValue(result));
  return normalizeSymbolsPayload(redacted);
}

/**
 * Deals de histórico não vêm com shape documentado — pode ser array puro ou
 * envelopado sob 'deals'/'history'/'result'. Tolera as formas mais
 * prováveis, só para esta capability.
 */
function normalizeHistoryPayload(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    for (const key of ['deals', 'history', 'result'] as const) {
      const candidate = (value as Record<string, unknown>)[key];
      if (Array.isArray(candidate)) return candidate;
    }
  }
  return [];
}

export interface Mt5HistoryParams {
  readonly from?: string;
  readonly to?: string;
  readonly symbol?: string;
}

export async function getHistoryDeals(params: Mt5HistoryParams = {}): Promise<unknown[]> {
  const toolName = await resolveMt5ToolName('history');
  const args: Record<string, unknown> = {};
  if (params.from) args.from = params.from;
  if (params.to) args.to = params.to;
  if (params.symbol) args.symbol = params.symbol;
  const result = await callMt5Tool(toolName, args);
  const redacted = redactSensitiveFields(extractToolValue(result));
  return normalizeHistoryPayload(redacted);
}

/** Ordens abertas não vêm com shape documentado — pode ser array puro ou envelopado sob 'orders'/'result'. */
function normalizeOrdersPayload(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    for (const key of ['orders', 'result'] as const) {
      const candidate = (value as Record<string, unknown>)[key];
      if (Array.isArray(candidate)) return candidate;
    }
  }
  return [];
}

/**
 * Nesta versão real do servidor não existe tool dedicada de "ordens abertas"
 * (`orders` não tem candidato em TOOL_NAME_CANDIDATES). O único jeito
 * confirmado de obter ordens pendentes é `get_trading_open_positions` com
 * `include_orders: true` — devolve `{ positions: [...], orders: [...] }` no
 * mesmo payload (verificado por sonda real). Por isso esta função usa a
 * capability `positions`, não `orders`, e extrai só o array `orders`.
 */
export async function getOrders(symbol?: string): Promise<unknown[]> {
  const toolName = await resolveMt5ToolName('positions');
  const args: Record<string, unknown> = { include_orders: true };
  if (symbol) args.symbol = symbol;
  const result = await callMt5Tool(toolName, args);
  const redacted = redactSensitiveFields(extractToolValue(result));
  return normalizeOrdersPayload(redacted);
}

/** symbol_info não vem com shape documentado — pode ser objeto direto ou envelopado sob 'symbol_info'/'result'. */
function normalizeSymbolInfoPayload(value: unknown): unknown {
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if ('symbol_info' in obj) return obj.symbol_info;
    if ('result' in obj && typeof obj.result === 'object') return obj.result;
  }
  return value;
}

export async function getSymbolInfo(symbol: string): Promise<unknown> {
  const toolName = await resolveMt5ToolName('symbol_info');
  const result = await callMt5Tool(toolName, { symbol });
  return normalizeSymbolInfoPayload(redactSensitiveFields(extractToolValue(result)));
}

/** market_book não vem com shape documentado — pode já vir separado ({bids,asks}) ou envelopado sob 'market_book'/'book'/'result'. */
function normalizeMarketBookPayload(value: unknown): unknown {
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if ('bids' in obj || 'asks' in obj) return obj;
    for (const key of ['market_book', 'book', 'result'] as const) {
      if (key in obj) return obj[key];
    }
  }
  return value;
}

export async function getMarketBook(symbol: string): Promise<unknown> {
  const toolName = await resolveMt5ToolName('market_book');
  const result = await callMt5Tool(toolName, { symbol });
  return normalizeMarketBookPayload(redactSensitiveFields(extractToolValue(result)));
}

/**
 * Envio/alteração/cancelamento/fechamento de ordem — habilitado em
 * 2026-08-02. O servidor MCP nativo do MT5 EXPÕE tools reais de trade
 * (`trade_send_market_order` etc., verificadas por sonda ao vivo) — a
 * plataforma deixou de ser fail-closed por decisão do usuário. Cada função
 * abaixo só envia os campos exatamente como o schema real exige
 * (`additionalProperties: false` no servidor rejeita qualquer campo extra).
 */

export interface Mt5MarketOrderParams {
  readonly symbol: string;
  readonly side: 'buy' | 'sell';
  readonly volume: number;
  readonly sl?: number;
  readonly tp?: number;
  readonly comment?: string;
}

export async function sendMarketOrder(params: Mt5MarketOrderParams): Promise<unknown> {
  await assertTradingEligible();
  await ensureSymbolInMarketWatch(params.symbol);
  const toolName = await resolveMt5ToolName('order_send_market');
  const args: Record<string, unknown> = { symbol: params.symbol, type: params.side, volume: params.volume };
  if (typeof params.sl === 'number') args.sl = params.sl;
  if (typeof params.tp === 'number') args.tp = params.tp;
  if (params.comment) args.comment = params.comment.slice(0, 31);
  const result = await callMt5Tool(toolName, args);
  return redactSensitiveFields(extractToolValue(result));
}

export interface Mt5PendingOrderParams {
  readonly symbol: string;
  readonly type: 'buy_limit' | 'sell_limit' | 'buy_stop' | 'sell_stop' | 'buy_stop_limit' | 'sell_stop_limit';
  readonly volume: number;
  readonly price: number;
  readonly stoplimit?: number;
  readonly sl?: number;
  readonly tp?: number;
  readonly comment?: string;
}

export async function sendPendingOrder(params: Mt5PendingOrderParams): Promise<unknown> {
  await assertTradingEligible();
  await ensureSymbolInMarketWatch(params.symbol);
  const toolName = await resolveMt5ToolName('order_send_pending');
  const args: Record<string, unknown> = {
    symbol: params.symbol,
    type: params.type,
    volume: params.volume,
    price: params.price,
  };
  if (typeof params.stoplimit === 'number') args.stoplimit = params.stoplimit;
  if (typeof params.sl === 'number') args.sl = params.sl;
  if (typeof params.tp === 'number') args.tp = params.tp;
  if (params.comment) args.comment = params.comment.slice(0, 31);
  const result = await callMt5Tool(toolName, args);
  return redactSensitiveFields(extractToolValue(result));
}

export interface Mt5ModifySlTpParams {
  readonly symbol: string;
  readonly positionTicket?: number;
  readonly orderTicket?: number;
  readonly sl?: number;
  readonly tp?: number;
}

/** `sl`/`tp` = 0 remove o stop/take existente — schema real distingue "0" de "omitido" (mantém atual). */
export async function modifySlTp(params: Mt5ModifySlTpParams): Promise<unknown> {
  await assertTradingEligible();
  const toolName = await resolveMt5ToolName('order_modify_sltp');
  const args: Record<string, unknown> = { symbol: params.symbol };
  if (typeof params.positionTicket === 'number') args.position_ticket = params.positionTicket;
  if (typeof params.orderTicket === 'number') args.order_ticket = params.orderTicket;
  if (typeof params.sl === 'number') args.sl = params.sl;
  if (typeof params.tp === 'number') args.tp = params.tp;
  const result = await callMt5Tool(toolName, args);
  return redactSensitiveFields(extractToolValue(result));
}

export async function deletePendingOrder(symbol: string, orderTicket: number): Promise<unknown> {
  await assertTradingEligible();
  const toolName = await resolveMt5ToolName('order_delete_pending');
  const result = await callMt5Tool(toolName, { symbol, order_ticket: orderTicket });
  return redactSensitiveFields(extractToolValue(result));
}

export async function closeSinglePosition(symbol: string, positionTicket: number): Promise<unknown> {
  await assertTradingEligible();
  const toolName = await resolveMt5ToolName('position_close_single');
  const result = await callMt5Tool(toolName, { symbol, position_ticket: positionTicket });
  return redactSensitiveFields(extractToolValue(result));
}

export async function closePositionByOpposite(
  symbol: string,
  positionTicket: number,
  positionTicketBy: number
): Promise<unknown> {
  await assertTradingEligible();
  const toolName = await resolveMt5ToolName('position_close_by');
  const result = await callMt5Tool(toolName, {
    symbol,
    position_ticket: positionTicket,
    position_ticket_by: positionTicketBy,
  });
  return redactSensitiveFields(extractToolValue(result));
}
