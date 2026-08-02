/**
 * Ordens abertas (read-only) — MT5 MCP nativo — WR Trading Pro
 *
 * GET ?symbol=: consulta a capability `orders` via MCP nativo e devolve a
 * lista sanitizada. Somente leitura — nenhuma rota sob /api/mt5/mcp/**
 * envia, modifica ou fecha ordem/posição.
 *
 * `symbol` é opcional (como em /positions) — sem ele, devolve todas as
 * ordens abertas.
 *
 * Nunca retorna o Bearer, o envelope JSON-RPC bruto, nem stack
 * trace/mensagem de driver — só o código de erro tipado (ver
 * src/types/mt5-mcp.ts) e uma mensagem já pronta para exibir ao usuário.
 *
 * Rota já protegida pelo middleware global de autenticação
 * (src/middleware.ts): tudo sob /api, exceto /api/auth/*, exige sessão
 * válida.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getMt5McpConfig } from '@/lib/server/mt5-mcp-config';
import { getOrders } from '@/lib/server/mt5-mcp-tools';
import { Mt5McpError } from '@/lib/server/mt5-mcp-client';
import { MT5_MCP_ERROR_MESSAGES, type Mt5McpErrorPayload } from '@/types/mt5-mcp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const config = await getMt5McpConfig();
  if (!config) {
    const payload: Mt5McpErrorPayload = {
      code: 'MT5_MCP_NOT_CONFIGURED',
      message: MT5_MCP_ERROR_MESSAGES.MT5_MCP_NOT_CONFIGURED,
    };
    return NextResponse.json({ success: false, error: payload }, { status: 503 });
  }

  const symbol = request.nextUrl.searchParams.get('symbol')?.trim() || undefined;

  try {
    const orders = await getOrders(symbol);
    return NextResponse.json({ success: true, data: { orders } });
  } catch (error) {
    const payload: Mt5McpErrorPayload =
      error instanceof Mt5McpError
        ? error.toPayload()
        : { code: 'MT5_MCP_TOOL_ERROR', message: MT5_MCP_ERROR_MESSAGES.MT5_MCP_TOOL_ERROR };
    console.error('[api/mt5/mcp/orders]', payload.code);
    return NextResponse.json({ success: false, error: payload }, { status: 502 });
  }
}
