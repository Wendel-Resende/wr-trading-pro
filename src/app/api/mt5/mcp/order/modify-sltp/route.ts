/**
 * Alteração de stop loss/take profit (WRITE) — MT5 MCP nativo — WR Trading Pro
 *
 * POST { symbol, positionTicket?, orderTicket?, sl?, tp? }: exatamente um de
 * positionTicket/orderTicket deve ser informado (posição aberta ou ordem
 * pendente). `sl`/`tp` = 0 remove o stop/take existente; omitido mantém o
 * valor atual (schema real do MCP nativo distingue os dois casos).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getMt5McpConfig } from '@/lib/server/mt5-mcp-config';
import { modifySlTp } from '@/lib/server/mt5-mcp-tools';
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
  const positionTicket = typeof body?.positionTicket === 'number' ? body.positionTicket : undefined;
  const orderTicket = typeof body?.orderTicket === 'number' ? body.orderTicket : undefined;
  if (!symbol || (positionTicket === undefined) === (orderTicket === undefined)) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'MT5_MCP_TOOL_ERROR',
          message: 'Parâmetros obrigatórios: symbol e exatamente um de positionTicket/orderTicket.',
        },
      },
      { status: 400 }
    );
  }
  const sl = typeof body?.sl === 'number' ? body.sl : undefined;
  const tp = typeof body?.tp === 'number' ? body.tp : undefined;

  try {
    const result = await modifySlTp({ symbol, positionTicket, orderTicket, sl, tp });
    return NextResponse.json({ success: true, data: { result } });
  } catch (error) {
    const payload: Mt5McpErrorPayload =
      error instanceof Mt5McpError
        ? error.toPayload()
        : { code: 'MT5_MCP_TOOL_ERROR', message: MT5_MCP_ERROR_MESSAGES.MT5_MCP_TOOL_ERROR };
    console.error('[api/mt5/mcp/order/modify-sltp]', payload.code);
    return NextResponse.json({ success: false, error: payload }, { status: 502 });
  }
}
