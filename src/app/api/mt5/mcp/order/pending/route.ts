/**
 * Envio de ordem pendente (WRITE) — MT5 MCP nativo — WR Trading Pro
 *
 * POST { symbol, type, volume, price, stoplimit?, sl?, tp?, comment? }:
 * checa `assertTradingEligible()` e chama `trade_send_pending_order`.
 * `type` deve ser um de: buy_limit, sell_limit, buy_stop, sell_stop,
 * buy_stop_limit, sell_stop_limit (nomes exatos do schema real do MCP nativo).
 *
 * Nunca retorna o Bearer, o envelope JSON-RPC bruto, nem stack
 * trace/mensagem de driver — só o código de erro tipado e uma mensagem já
 * pronta para exibir ao usuário.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getMt5McpConfig } from '@/lib/server/mt5-mcp-config';
import { sendPendingOrder, type Mt5PendingOrderParams } from '@/lib/server/mt5-mcp-tools';
import { Mt5McpError } from '@/lib/server/mt5-mcp-client';
import { MT5_MCP_ERROR_MESSAGES, type Mt5McpErrorPayload } from '@/types/mt5-mcp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_TYPES = ['buy_limit', 'sell_limit', 'buy_stop', 'sell_stop', 'buy_stop_limit', 'sell_stop_limit'] as const;

export async function POST(request: NextRequest) {
  const config = getMt5McpConfig();
  if (!config) {
    const payload: Mt5McpErrorPayload = {
      code: 'MT5_MCP_NOT_CONFIGURED',
      message: MT5_MCP_ERROR_MESSAGES.MT5_MCP_NOT_CONFIGURED,
    };
    return NextResponse.json({ success: false, error: payload }, { status: 503 });
  }

  const body = await request.json().catch(() => null);
  const symbol = typeof body?.symbol === 'string' ? body.symbol.trim() : '';
  const type = VALID_TYPES.includes(body?.type) ? (body.type as Mt5PendingOrderParams['type']) : null;
  const volume = typeof body?.volume === 'number' && body.volume > 0 ? body.volume : null;
  const price = typeof body?.price === 'number' && body.price > 0 ? body.price : null;
  if (!symbol || !type || !volume || !price) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'MT5_MCP_TOOL_ERROR',
          message: `Parâmetros obrigatórios: symbol, type (${VALID_TYPES.join('/')}), volume (> 0), price (> 0).`,
        },
      },
      { status: 400 }
    );
  }
  const stoplimit = typeof body?.stoplimit === 'number' ? body.stoplimit : undefined;
  const sl = typeof body?.sl === 'number' ? body.sl : undefined;
  const tp = typeof body?.tp === 'number' ? body.tp : undefined;
  const comment = typeof body?.comment === 'string' ? body.comment : undefined;

  try {
    const result = await sendPendingOrder({ symbol, type, volume, price, stoplimit, sl, tp, comment });
    return NextResponse.json({ success: true, data: { result } });
  } catch (error) {
    const payload: Mt5McpErrorPayload =
      error instanceof Mt5McpError
        ? error.toPayload()
        : { code: 'MT5_MCP_TOOL_ERROR', message: MT5_MCP_ERROR_MESSAGES.MT5_MCP_TOOL_ERROR };
    console.error('[api/mt5/mcp/order/pending]', payload.code);
    return NextResponse.json({ success: false, error: payload }, { status: 502 });
  }
}
