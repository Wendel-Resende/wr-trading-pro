/**
 * Tools de conta/posições/ordens/candles/book — repassam para o MT5 MCP
 * nativo via os wrappers server-side de `mt5-mcp-tools.ts` (mesmo cliente
 * usado pelas rotas /api/mt5/mcp/**). Sem sessão nativa disponível (ou sem
 * MT5_MCP_API_KEY configurado), os wrappers lançam `Mt5McpError` — nunca
 * inventamos posições/saldos/candles quando o MT5 está fora do ar.
 *
 * Envelope JSON de cada tool mantido idêntico ao que o bridge legado
 * (`python/mt5_bridge.py`) devolvia, para não quebrar consumidores do
 * piloto — ver handlers `handle_get_positions_snapshot` (linha 545),
 * `handle_get_account_info` (524), `handle_get_orders_snapshot` (568),
 * `handle_get_history_snapshot` (589), `handle_get_chart_data` (~1196) e
 * `handle_get_order_book` (~1014) no bridge. Duas exceções deliberadas,
 * já que não há mais correlação de request via WS: `requestId` de
 * CHART_DATA foi descartado (era só correlação interna do protocolo WS,
 * o MCP já correlaciona por si); `digits` do book não é reproduzido pois
 * o wrapper nativo `getMarketBook` não expõe esse campo separadamente.
 */
import { z } from 'zod';
import { parseToolArgs, toToolError, type McpToolDefinition } from '../../tools/registry-types';
import { getAccountInfo, getPositions, getOrders, getHistoryDeals, getRates, getMarketBook } from '../../../lib/server/mt5-mcp-tools';

export function buildPortfolioTools(): readonly McpToolDefinition[] {
  return [
    {
      name: 'portfolio.get_positions',
      description: 'Snapshot agregado das posições abertas no MT5 (vazio explícito se não houver nenhuma).',
      privilege: 'free',
      inputSchema: {},
      handler: async () => {
        try { return { content: [{ type: 'text', text: JSON.stringify({ positions: await getPositions() }) }] }; }
        catch (error) { return toToolError(error); }
      },
    },
    {
      name: 'portfolio.get_account',
      description: 'Dados da conta MT5: saldo, equity, margem, alavancagem e modo (demo/real).',
      privilege: 'free',
      inputSchema: {},
      handler: async () => {
        try { return { content: [{ type: 'text', text: JSON.stringify(await getAccountInfo()) }] }; }
        catch (error) { return toToolError(error); }
      },
    },
    {
      name: 'orders.list_open',
      description: 'Snapshot agregado das ordens pendentes no MT5 (vazio explícito se não houver nenhuma).',
      privilege: 'free',
      inputSchema: {},
      handler: async () => {
        try { return { content: [{ type: 'text', text: JSON.stringify({ orders: await getOrders() }) }] }; }
        catch (error) { return toToolError(error); }
      },
    },
    {
      name: 'orders.history',
      description: 'Snapshot agregado do histórico de negociações (deals) do dia no MT5.',
      privilege: 'free',
      inputSchema: {},
      handler: async () => {
        try { return { content: [{ type: 'text', text: JSON.stringify({ trades: await getHistoryDeals() }) }] }; }
        catch (error) { return toToolError(error); }
      },
    },
    {
      name: 'market.get_live_candles',
      description: 'Candles ao vivo do MT5 para um símbolo/timeframe/quantidade.',
      privilege: 'free',
      inputSchema: { symbol: z.string().min(1).max(20), timeframe: z.string().min(1).max(10), count: z.number().int().min(1).max(5000) },
      handler: async (args) => {
        try {
          const parsed = parseToolArgs({ symbol: z.string().min(1).max(20), timeframe: z.string().min(1).max(10), count: z.number().int().min(1).max(5000) }, args);
          const candles = await getRates({ symbol: parsed.symbol, timeframe: parsed.timeframe, count: parsed.count });
          return { content: [{ type: 'text', text: JSON.stringify({ symbol: parsed.symbol, timeframe: parsed.timeframe, candles }) }] };
        } catch (error) { return toToolError(error); }
      },
    },
    {
      name: 'market.get_order_book',
      description: 'Book de ofertas (DOM) do MT5 para um símbolo.',
      privilege: 'free',
      inputSchema: { symbol: z.string().min(1).max(20) },
      handler: async (args) => {
        try {
          const { symbol } = parseToolArgs({ symbol: z.string().min(1).max(20) }, args);
          const book = await getMarketBook(symbol);
          const bookFields = book && typeof book === 'object' ? (book as Record<string, unknown>) : {};
          return { content: [{ type: 'text', text: JSON.stringify({ ...bookFields, symbol }) }] };
        } catch (error) { return toToolError(error); }
      },
    },
  ];
}
