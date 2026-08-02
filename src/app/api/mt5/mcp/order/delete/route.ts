/**
 * Cancelamento de ordem pendente (WRITE) — MT5 MCP nativo — WR Trading Pro
 *
 * POST { symbol, orderTicket }: checa `assertTradingEligible()` e chama
 * `trade_delete_order`. Só cancela ordem PENDENTE (não fecha posição — ver
 * /api/mt5/mcp/order/close para isso).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getMt5McpConfig } from '@/lib/server/mt5-mcp-config';
import { deletePendingOrder } from '@/lib/server/mt5-mcp-tools';
import { Mt5McpError } from '@/lib/server/mt5-mcp-client';
import { MT5_MCP_ERROR_MESSAGES, type Mt5McpErrorPayload } from '@/types/mt5-mcp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const config = await getMt5McpConfig();
  if (!config) {
    const payload: Mt5McpErrorPayload = {
      code: 'MT5_MCP_NOT_CONFIGURED',
      message: MT5_MCP_ERROR_MESSAGES.MT5_MCP_NOT_CONFIGURED,
    };
    return NextResponse.json({ success: false, error: payload }, { status: 503 });
  }

  const body = await request.json().catch(() => null);
  const symbol = typeof body?.symbol === 'string' ? body.symbol.trim() : '';
  const orderTicket = typeof body?.orderTicket === 'number' ? body.orderTicket : null;
  if (!symbol || !orderTicket) {
    return NextResponse.json(
      { success: false, error: { code: 'MT5_MCP_TOOL_ERROR', message: 'Parâmetros obrigatórios: symbol, orderTicket.' } },
      { status: 400 }
    );
  }

  try {
    const result = await deletePendingOrder(symbol, orderTicket);
    return NextResponse.json({ success: true, data: { result } });
  } catch (error) {
    const payload: Mt5McpErrorPayload =
      error instanceof Mt5McpError
        ? error.toPayload()
        : { code: 'MT5_MCP_TOOL_ERROR', message: MT5_MCP_ERROR_MESSAGES.MT5_MCP_TOOL_ERROR };
    console.error('[api/mt5/mcp/order/delete]', payload.code);
    return NextResponse.json({ success: false, error: payload }, { status: 502 });
  }
}
