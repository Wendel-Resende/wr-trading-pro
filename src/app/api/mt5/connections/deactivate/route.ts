/**
 * Desativar perfil de conexão MT5 ativo — WR Trading Pro
 *
 * POST: desmarca qualquer perfil ativo — a plataforma volta a usar
 * MT5_MCP_ENDPOINT/MT5_MCP_API_KEY do `.env` (se configurados) como
 * fallback. Invalida o client/cache de tools do MCP nativo.
 */

import { NextResponse } from 'next/server';
import { clearActiveMt5ConnectionProfile } from '@/lib/server/mt5-connection-store';
import { __resetMt5McpClientForTests } from '@/lib/server/mt5-mcp-client';
import { __resetMt5McpToolCacheForTests } from '@/lib/server/mt5-mcp-tools';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  await clearActiveMt5ConnectionProfile();
  __resetMt5McpClientForTests();
  __resetMt5McpToolCacheForTests();
  return NextResponse.json({ success: true });
}
