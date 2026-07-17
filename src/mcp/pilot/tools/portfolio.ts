/**
 * Tools de conta/posições/ordens/candles/book — repassam para o bridge MT5
 * via `BridgeClient` injetado (ver `clients/mt5-bridge.ts`). Sem MT5
 * conectado, o bridge responde `ERROR{code:'NOT_CONNECTED'}`, que o
 * cliente traduz para `ReadModelError('MT5_DISCONNECTED', ...)` — nunca
 * inventamos posições/saldos/candles quando o MT5 está fora do ar.
 */
import { z } from 'zod';
import { parseToolArgs, toToolError, type McpToolDefinition } from '../../tools/registry-types';
import type { BridgeClient } from '../clients/mt5-bridge';

export function buildPortfolioTools(bridge: BridgeClient): readonly McpToolDefinition[] {
  return [
    {
      name: 'portfolio.get_positions',
      description: 'Snapshot agregado das posições abertas no MT5 (vazio explícito se não houver nenhuma).',
      privilege: 'free',
      inputSchema: {},
      handler: async () => {
        try { return { content: [{ type: 'text', text: JSON.stringify(await bridge.request('GET_POSITIONS_SNAPSHOT')) }] }; }
        catch (error) { return toToolError(error); }
      },
    },
    {
      name: 'portfolio.get_account',
      description: 'Dados da conta MT5: saldo, equity, margem, alavancagem e modo (demo/real).',
      privilege: 'free',
      inputSchema: {},
      handler: async () => {
        try { return { content: [{ type: 'text', text: JSON.stringify(await bridge.request('GET_ACCOUNT_INFO')) }] }; }
        catch (error) { return toToolError(error); }
      },
    },
    {
      name: 'orders.list_open',
      description: 'Snapshot agregado das ordens pendentes no MT5 (vazio explícito se não houver nenhuma).',
      privilege: 'free',
      inputSchema: {},
      handler: async () => {
        try { return { content: [{ type: 'text', text: JSON.stringify(await bridge.request('GET_ORDERS_SNAPSHOT')) }] }; }
        catch (error) { return toToolError(error); }
      },
    },
    {
      name: 'orders.history',
      description: 'Snapshot agregado do histórico de negociações (deals) do dia no MT5.',
      privilege: 'free',
      inputSchema: {},
      handler: async () => {
        try { return { content: [{ type: 'text', text: JSON.stringify(await bridge.request('GET_HISTORY_SNAPSHOT')) }] }; }
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
          // Wrapper `data: {}` — regra registrada no CLAUDE.md para GET_CHART_DATA.
          return { content: [{ type: 'text', text: JSON.stringify(await bridge.request('GET_CHART_DATA', { symbol: parsed.symbol, timeframe: parsed.timeframe, count: parsed.count })) }] };
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
          return { content: [{ type: 'text', text: JSON.stringify(await bridge.request('GET_ORDER_BOOK', { symbol })) }] };
        } catch (error) { return toToolError(error); }
      },
    },
  ];
}
