/**
 * MCP Piloto — broker de execução do trilho de trade governado
 * (`McpTradeService.approve`).
 *
 * Habilitado em 2026-08-02: envia ordem a mercado de verdade via
 * `trade_send_market_order` do MCP nativo do MT5, reaproveitando
 * `sendMarketOrder` de `src/lib/server/mt5-mcp-tools.ts` — cujo módulo é
 * livre de alias de path (só imports relativos), então pode ser importado
 * aqui sem quebrar o runtime `node` puro dos testes
 * (`scripts/mcp-pilot/run-mcp-pilot-tests.cjs`, sem `tsc-alias`).
 *
 * Este broker NÃO substitui nenhum guard-rail do `McpTradeService`
 * (rate-limit, allowlist, limite de notional/concentração, código de
 * confirmação de 6 dígitos, kill switch `WR_TRADING_ENABLED`) — `send()` só
 * é chamado depois que todos esses já passaram (ver `service.ts:approve`).
 */
import type { PilotExecutionPort, PilotOrderRequest, PilotOrderResult } from '../../../domain/v1/ports/pilot-execution';
import { sendMarketOrder } from '../../../lib/server/mt5-mcp-tools';
import { Mt5McpError } from '../../../lib/server/mt5-mcp-client';

function extractTicket(result: unknown): number | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const obj = result as Record<string, unknown>;
  const candidate = obj.order ?? obj.deal ?? obj.order_ticket ?? obj.position_ticket;
  return typeof candidate === 'number' ? candidate : undefined;
}

function extractPrice(result: unknown): number | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const price = (result as Record<string, unknown>).price;
  return typeof price === 'number' ? price : undefined;
}

export class Mt5DemoBroker implements PilotExecutionPort {
  async send(request: PilotOrderRequest): Promise<PilotOrderResult> {
    try {
      const result = await sendMarketOrder({
        symbol: request.symbol,
        side: request.direction === 'BUY' ? 'buy' : 'sell',
        volume: request.volume,
        sl: request.stopLoss,
        tp: request.takeProfit,
        comment: request.comment,
      });
      return { ok: true, ticket: extractTicket(result), price: extractPrice(result) };
    } catch (error) {
      const message = error instanceof Mt5McpError ? error.message : 'Falha ao enviar ordem ao MT5.';
      return { ok: false, error: message };
    }
  }
}
