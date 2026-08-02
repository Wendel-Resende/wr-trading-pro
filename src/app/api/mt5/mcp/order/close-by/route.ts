/**
 * Fechamento por posição oposta (WRITE) — MT5 MCP nativo — WR Trading Pro
 *
 * POST { symbol, positionTicket, positionTicketBy }: checa
 * `assertTradingEligible()` e chama `trade_close_by_position`. As duas
 * posições precisam ser do mesmo símbolo e de lados opostos.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getMt5McpConfig } from '@/lib/server/mt5-mcp-config';
import { closePositionByOpposite } from '@/lib/server/mt5-mcp-tools';
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
  const positionTicketBy = typeof body?.positionTicketBy === 'number' ? body.positionTicketBy : null;
  if (!symbol || !positionTicket || !positionTicketBy) {
    return NextResponse.json(
      {
        success: false,
        error: { code: 'MT5_MCP_TOOL_ERROR', message: 'Parâmetros obrigatórios: symbol, positionTicket, positionTicketBy.' },
      },
      { status: 400 }
    );
  }

  try {
    const result = await closePositionByOpposite(symbol, positionTicket, positionTicketBy);
    return NextResponse.json({ success: true, data: { result } });
  } catch (error) {
    const payload: Mt5McpErrorPayload =
      error instanceof Mt5McpError
        ? error.toPayload()
        : { code: 'MT5_MCP_TOOL_ERROR', message: MT5_MCP_ERROR_MESSAGES.MT5_MCP_TOOL_ERROR };
    console.error('[api/mt5/mcp/order/close-by]', payload.code);
    return NextResponse.json({ success: false, error: payload }, { status: 502 });
  }
}
