/**
 * Elegibilidade de trading (somente leitura) — MT5 MCP nativo — WR Trading Pro
 *
 * GET: deriva de account_info se o terminal permite trading (AutoTrading
 * ligado, conta com permissão). Usado só para a UI decidir se mostra um
 * botão de ordem habilitado/desabilitado em fases futuras — não abre
 * nenhum caminho de envio de ordem, e não altera o gate hardcoded
 * eligibleForExecution=false da plataforma.
 *
 * Rota já protegida pelo middleware global de autenticação
 * (src/middleware.ts): tudo sob /api, exceto /api/auth/*, exige sessão
 * válida.
 */

import { NextResponse } from 'next/server';
import { getMt5McpConfig } from '@/lib/server/mt5-mcp-config';
import { getTradingEligibility } from '@/lib/server/mt5-mcp-tools';
import { Mt5McpError } from '@/lib/server/mt5-mcp-client';
import { MT5_MCP_ERROR_MESSAGES, type Mt5McpErrorPayload } from '@/types/mt5-mcp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const config = getMt5McpConfig();
  if (!config) {
    const payload: Mt5McpErrorPayload = {
      code: 'MT5_MCP_NOT_CONFIGURED',
      message: MT5_MCP_ERROR_MESSAGES.MT5_MCP_NOT_CONFIGURED,
    };
    return NextResponse.json({ success: false, error: payload }, { status: 503 });
  }

  try {
    const eligibility = await getTradingEligibility();
    return NextResponse.json({ success: true, data: eligibility });
  } catch (error) {
    const payload: Mt5McpErrorPayload =
      error instanceof Mt5McpError
        ? error.toPayload()
        : { code: 'MT5_MCP_TOOL_ERROR', message: MT5_MCP_ERROR_MESSAGES.MT5_MCP_TOOL_ERROR };
    console.error('[api/mt5/mcp/trading-eligibility]', payload.code);
    return NextResponse.json({ success: false, error: payload }, { status: 502 });
  }
}
