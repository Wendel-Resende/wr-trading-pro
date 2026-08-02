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
  | 'market_book';

/**
 * Candidatos por capability, em ordem de preferência. Cobre as convenções
 * mais comuns entre servidores MCP de MT5 — ajustado no smoke-test real
 * (Fase 1) assim que o Guardião configurar MT5_MCP_API_KEY de verdade.
 */
const TOOL_NAME_CANDIDATES: Record<Mt5McpCapability, readonly string[]> = {
  workspace_info: ['get_workspace_info', 'workspace_info'],
  account_info: ['get_account_info', 'account_info', 'get_account'],
  positions: ['get_positions', 'positions', 'list_positions'],
  orders: ['get_orders', 'orders', 'list_orders', 'get_open_orders'],
  history: ['get_history_deals', 'get_history', 'history_deals', 'get_deals_history'],
  symbols: ['get_symbols', 'symbols', 'list_symbols'],
  symbol_info: ['get_symbol_info', 'symbol_info'],
  rates: ['get_rates', 'get_candles', 'copy_rates', 'get_bars'],
  tick: ['get_tick', 'get_symbol_price', 'get_last_tick', 'symbol_info_tick'],
  market_book: ['get_market_book', 'get_depth', 'market_book_get', 'get_order_book'],
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
 * Info da conta logada no terminal (via GUI do próprio MT5 — nunca por
 * login/senha vindos do WR). Se o terminal estiver aberto mas sem conta
 * logada, o client já classifica isso como MT5_MCP_TERMINAL_DISCONNECTED
 * (ver isTerminalDisconnectedMessage em mt5-mcp-client.ts) — o chamador
 * decide se trata como erro fatal ou estado "conectado sem conta".
 */
export async function getAccountInfo(): Promise<unknown> {
  const toolName = await resolveMt5ToolName('account_info');
  const result = await callMt5Tool(toolName, {});
  return redactSensitiveFields(extractToolValue(result));
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
 * Gate SOMENTE LEITURA para uso futuro da UI (ex.: desabilitar botão de
 * ordem quando o terminal não permite trading). Deriva exclusivamente de
 * account_info — nunca referencia nenhuma tool de envio/escrita de ordem, e
 * não abre nenhum caminho de execução. `eligibleForExecution` da
 * plataforma continua hardcoded false nos gates existentes,
 * independentemente do resultado desta função.
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

export async function getTick(symbol: string): Promise<unknown> {
  const toolName = await resolveMt5ToolName('tick');
  const result = await callMt5Tool(toolName, { symbol });
  return normalizeTickPayload(redactSensitiveFields(extractToolValue(result)));
}

/**
 * Rates (candles OHLCV) não vêm com shape documentado — pode ser array puro
 * ou envelopado sob 'rates'/'candles'/'bars'/'result'. Tolera as formas mais
 * prováveis, só para esta capability.
 */
function normalizeRatesPayload(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    for (const key of ['rates', 'candles', 'bars', 'result'] as const) {
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

export async function getRates(params: Mt5RatesParams): Promise<unknown[]> {
  const toolName = await resolveMt5ToolName('rates');
  const args: Record<string, unknown> = { symbol: params.symbol };
  if (params.timeframe) args.timeframe = params.timeframe;
  if (typeof params.count === 'number') args.count = params.count;
  if (params.from) args.from = params.from;
  if (params.to) args.to = params.to;
  const result = await callMt5Tool(toolName, args);
  const redacted = redactSensitiveFields(extractToolValue(result));
  return normalizeRatesPayload(redacted);
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

export async function getOrders(symbol?: string): Promise<unknown[]> {
  const toolName = await resolveMt5ToolName('orders');
  const args: Record<string, unknown> = {};
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
