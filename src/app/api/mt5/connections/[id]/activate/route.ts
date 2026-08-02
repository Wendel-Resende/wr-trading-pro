/**
 * Ativar perfil de conexão MT5 (WRITE de configuração) — WR Trading Pro
 *
 * POST: marca `id` como ativo e desativa todos os outros (transacional —
 * nunca dois perfis ativos ao mesmo tempo), e invalida o client MCP e o
 * cache de nomes de tool descobertos (`mt5-mcp-client.ts`/
 * `mt5-mcp-tools.ts`) — sem isso, a próxima chamada continuaria usando a
 * sessão/API key do perfil anterior até uma falha forçar reconexão.
 */

import { NextResponse } from 'next/server';
import { setActiveMt5ConnectionProfile } from '@/lib/server/mt5-connection-store';
import { __resetMt5McpClientForTests } from '@/lib/server/mt5-mcp-client';
import { __resetMt5McpToolCacheForTests } from '@/lib/server/mt5-mcp-tools';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await setActiveMt5ConnectionProfile(id);
  if (!result.ok) {
    return NextResponse.json({ success: false, error: 'Perfil não encontrado.' }, { status: 404 });
  }
  __resetMt5McpClientForTests();
  __resetMt5McpToolCacheForTests();
  return NextResponse.json({ success: true });
}
