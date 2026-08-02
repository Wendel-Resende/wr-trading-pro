/**
 * Perfil de conexão MT5 MCP nativo individual — WR Trading Pro
 *
 * PATCH  — atualiza name/endpoint/apiKey (campos omitidos preservam valor atual).
 * DELETE — remove o perfil. Se era o ativo, a plataforma cai no fallback do `.env`.
 *
 * Se o perfil editado/removido estava ATIVO, invalida o client/cache de
 * tools do MCP nativo (mesma lógica de /activate) — senão a próxima
 * requisição continuaria usando a sessão da API key antiga até expirar.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  updateMt5ConnectionProfile,
  deleteMt5ConnectionProfile,
  listMt5ConnectionProfiles,
} from '@/lib/server/mt5-connection-store';
import { isAllowedMt5McpHost } from '@/lib/server/mt5-mcp-config';
import { __resetMt5McpClientForTests } from '@/lib/server/mt5-mcp-client';
import { __resetMt5McpToolCacheForTests } from '@/lib/server/mt5-mcp-tools';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    endpoint: z.string().trim().min(1).max(200).optional(),
    apiKey: z.string().trim().min(1).max(400).optional(),
  })
  .strict();

function isValidMt5Endpoint(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' && isAllowedMt5McpHost(url.hostname);
  } catch {
    return false;
  }
}

function invalidateMt5McpCaches(): void {
  __resetMt5McpClientForTests();
  __resetMt5McpToolCacheForTests();
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rawBody = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Payload inválido.', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  if (parsed.data.endpoint !== undefined && !isValidMt5Endpoint(parsed.data.endpoint)) {
    return NextResponse.json(
      { success: false, error: 'Endpoint deve ser http:// em loopback ou na faixa 172.16-31.x (WSL).' },
      { status: 400 }
    );
  }

  const wasActive = (await listMt5ConnectionProfiles()).find((p) => p.id === id)?.isActive ?? false;
  const result = await updateMt5ConnectionProfile(id, parsed.data);
  if (!result.ok) {
    const status = result.reason === 'not-found' ? 404 : 503;
    const error =
      result.reason === 'not-found'
        ? 'Perfil não encontrado.'
        : 'WR_LLM_CONFIG_ENCRYPTION_KEY ausente ou com menos de 32 caracteres — edição desabilitada (fail-closed).';
    return NextResponse.json({ success: false, error }, { status });
  }

  if (wasActive) invalidateMt5McpCaches();
  return NextResponse.json({ success: true, data: { profile: result.data } });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const wasActive = (await listMt5ConnectionProfiles()).find((p) => p.id === id)?.isActive ?? false;
  await deleteMt5ConnectionProfile(id);
  if (wasActive) invalidateMt5McpCaches();
  return NextResponse.json({ success: true });
}
