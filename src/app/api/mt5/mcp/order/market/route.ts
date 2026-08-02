/**
 * Envio de ordem a mercado (WRITE) — MT5 MCP nativo — WR Trading Pro
 *
 * POST { symbol, side: 'buy'|'sell', volume, sl?, tp?, comment? }: checa
 * `assertTradingEligible()` (AutoTrading/permissão da conta) e chama
 * `trade_send_market_order` via MCP nativo. Habilitado em 2026-08-02 —
 * antes desta data, todo envio de ordem era fail-closed por decisão de
 * governança (não limitação técnica do MCP nativo, que sempre teve essas
 * tools). Requer sessão autenticada (middleware global).
 *
 * Nunca retorna o Bearer, o envelope JSON-RPC bruto, nem stack
 * trace/mensagem de driver — só o código de erro tipado (ver
 * src/types/mt5-mcp.ts) e uma mensagem já pronta para exibir ao usuário.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getMt5McpConfig } from '@/lib/server/mt5-mcp-config';
import { sendMarketOrder } from '@/lib/server/mt5-mcp-tools';
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
  const side = body?.side === 'buy' || body?.side === 'sell' ? body.side : null;
  const volume = typeof body?.volume === 'number' && body.volume > 0 ? body.volume : null;
  if (!symbol || !side || !volume) {
    return NextResponse.json(
      { success: false, error: { code: 'MT5_MCP_TOOL_ERROR', message: 'Parâmetros obrigatórios: symbol, side ("buy"/"sell"), volume (> 0).' } },
      { status: 400 }
    );
  }
  const sl = typeof body?.sl === 'number' ? body.sl : undefined;
  const tp = typeof body?.tp === 'number' ? body.tp : undefined;
  const comment = typeof body?.comment === 'string' ? body.comment : undefined;

  try {
    const result = await sendMarketOrder({ symbol, side, volume, sl, tp, comment });
    return NextResponse.json({ success: true, data: { result } });
  } catch (error) {
    const payload: Mt5McpErrorPayload =
      error instanceof Mt5McpError
        ? error.toPayload()
        : { code: 'MT5_MCP_TOOL_ERROR', message: MT5_MCP_ERROR_MESSAGES.MT5_MCP_TOOL_ERROR };
    console.error('[api/mt5/mcp/order/market]', payload.code);
    return NextResponse.json({ success: false, error: payload }, { status: 502 });
  }
}
