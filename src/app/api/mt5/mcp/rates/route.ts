/**
 * Candles/rates OHLCV (read-only) — MT5 MCP nativo — WR Trading Pro
 *
 * GET ?symbol=XXXX&timeframe=&count=&from=&to=: consulta a capability
 * `rates` via MCP nativo e devolve a lista de candles sanitizada. Somente
 * leitura — nenhuma rota sob /api/mt5/mcp/** envia, modifica ou fecha
 * ordem/posição.
 *
 * `symbol` é obrigatório (como em /tick) — um candle sem símbolo não tem
 * sentido. Ausência retorna 400, sem sequer consultar o MCP nativo.
 * `timeframe`/`count`/`from`/`to` são opcionais e repassados como recebidos
 * (nomes reais de parâmetro do servidor nativo não são documentados
 * publicamente — mesma ressalva já registrada em mt5-mcp-tools.ts).
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
import { getRates } from '@/lib/server/mt5-mcp-tools';
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

  const params = request.nextUrl.searchParams;
  const symbol = params.get('symbol')?.trim();
  if (!symbol) {
    return NextResponse.json(
      { success: false, error: { code: 'MT5_MCP_TOOL_ERROR', message: 'Parâmetro "symbol" é obrigatório.' } },
      { status: 400 }
    );
  }

  const timeframe = params.get('timeframe')?.trim() || undefined;
  const countRaw = params.get('count');
  const count = countRaw && Number.isFinite(Number(countRaw)) ? Number(countRaw) : undefined;
  const from = params.get('from')?.trim() || undefined;
  const to = params.get('to')?.trim() || undefined;

  try {
    const rates = await getRates({ symbol, timeframe, count, from, to });
    return NextResponse.json({ success: true, data: { symbol, rates } });
  } catch (error) {
    const payload: Mt5McpErrorPayload =
      error instanceof Mt5McpError
        ? error.toPayload()
        : { code: 'MT5_MCP_TOOL_ERROR', message: MT5_MCP_ERROR_MESSAGES.MT5_MCP_TOOL_ERROR };
    console.error('[api/mt5/mcp/rates]', payload.code);
    return NextResponse.json({ success: false, error: payload }, { status: 502 });
  }
}
