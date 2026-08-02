/**
 * Status do MT5 MCP nativo (build 6060+) — WR Trading Pro
 *
 * GET: faz o handshake Streamable HTTP + a chamada de pre-flight
 * obrigatória (`get_workspace_info`), depois tenta `account_info`. Devolve
 * status sanitizado. Nunca retorna o Bearer, o envelope JSON-RPC bruto, nem
 * stack trace/mensagem de driver — só o código de erro tipado (ver
 * src/types/mt5-mcp.ts) e uma mensagem já pronta para exibir ao usuário.
 *
 * account_info é best-effort: se o terminal estiver aberto e a sessão MCP
 * ok, mas nenhuma conta estiver logada na GUI (MT5_MCP_TERMINAL_DISCONNECTED),
 * a resposta continua success:true/connected:true com accountInfo:null e
 * accountError preenchido — não é um erro fatal da rota, é um estado válido
 * ("MCP ok, faltou logar no terminal"). Qualquer outro erro em account_info
 * propaga como falha 502, igual ao workspace_info.
 *
 * Rota já protegida pelo middleware global de autenticação
 * (src/middleware.ts): tudo sob /api, exceto /api/auth/*, exige sessão
 * válida.
 *
 * Somente leitura — nenhum caminho de envio/modificação de ordem existe
 * aqui nem em nenhuma rota sob /api/mt5/mcp/**.
 */

import { NextResponse } from 'next/server';
import { getMt5McpConfig } from '@/lib/server/mt5-mcp-config';
import { getWorkspaceInfo, getAccountInfo } from '@/lib/server/mt5-mcp-tools';
import { Mt5McpError } from '@/lib/server/mt5-mcp-client';
import { MT5_MCP_ERROR_MESSAGES, type Mt5McpErrorPayload } from '@/types/mt5-mcp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function toErrorPayload(error: unknown): Mt5McpErrorPayload {
  return error instanceof Mt5McpError
    ? error.toPayload()
    : { code: 'MT5_MCP_TOOL_ERROR', message: MT5_MCP_ERROR_MESSAGES.MT5_MCP_TOOL_ERROR };
}

export async function GET() {
  const config = await getMt5McpConfig();
  if (!config) {
    const payload: Mt5McpErrorPayload = {
      code: 'MT5_MCP_NOT_CONFIGURED',
      message: MT5_MCP_ERROR_MESSAGES.MT5_MCP_NOT_CONFIGURED,
    };
    return NextResponse.json({ success: false, error: payload }, { status: 503 });
  }

  let workspaceInfo: unknown;
  try {
    workspaceInfo = await getWorkspaceInfo();
  } catch (error) {
    const payload = toErrorPayload(error);
    // Loga só o código classificado — nunca a mensagem/stack bruta do SDK/rede.
    console.error('[api/mt5/mcp/status] workspace_info', payload.code);
    return NextResponse.json({ success: false, error: payload }, { status: 502 });
  }

  let accountInfo: unknown = null;
  let accountError: Mt5McpErrorPayload | undefined;
  try {
    accountInfo = await getAccountInfo();
  } catch (error) {
    const payload = toErrorPayload(error);
    if (payload.code !== 'MT5_MCP_TERMINAL_DISCONNECTED') {
      console.error('[api/mt5/mcp/status] account_info', payload.code);
      return NextResponse.json({ success: false, error: payload }, { status: 502 });
    }
    accountError = payload;
  }

  return NextResponse.json({
    success: true,
    data: {
      connected: true,
      // Endpoint local (loopback/faixa WSL, já validado por allowlist) —
      // não é segredo, ajuda a diagnosticar; o token nunca é incluído.
      endpoint: config.endpoint,
      workspaceInfo,
      accountInfo,
      ...(accountError ? { accountError } : {}),
    },
  });
}
