/**
 * Fechamento de posição (WRITE) — MT5 MCP nativo — WR Trading Pro
 *
 * POST { symbol, positionTicket }: checa `assertTradingEligible()` e chama
 * `trade_close_single_position`. Fecha o VOLUME TOTAL da posição — o
 * schema real do MCP nativo não aceita fechamento parcial por volume.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getMt5McpConfig } from '@/lib/server/mt5-mcp-config';
import { closeSinglePosition } from '@/lib/server/mt5-mcp-tools';
import { Mt5McpError } from '@/lib/server/mt5-mcp-client';
import { MT5_MCP_ERROR_MESSAGES, type Mt5McpErrorPayload } from '@/types/mt5-mcp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  const positionTicket = typeof body?.positionTicket === 'number' ? body.positionTicket : null;
  if (!symbol || !positionTicket) {
    return NextResponse.json(
      { success: false, error: { code: 'MT5_MCP_TOOL_ERROR', message: 'Parâmetros obrigatórios: symbol, positionTicket.' } },
      { status: 400 }
    );
  }

  try {
    const result = await closeSinglePosition(symbol, positionTicket);
    return NextResponse.json({ success: true, data: { result } });
  } catch (error) {
    const payload: Mt5McpErrorPayload =
      error instanceof Mt5McpError
        ? error.toPayload()
        : { code: 'MT5_MCP_TOOL_ERROR', message: MT5_MCP_ERROR_MESSAGES.MT5_MCP_TOOL_ERROR };
    console.error('[api/mt5/mcp/order/close]', payload.code);
    return NextResponse.json({ success: false, error: payload }, { status: 502 });
  }
}
