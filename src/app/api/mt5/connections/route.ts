/**
 * Perfis de conexão MT5 MCP nativo (WRITE de configuração, não de trading)
 * — WR Trading Pro
 *
 * GET  — lista perfis cadastrados (nome/endpoint/ativo), NUNCA a API key.
 * POST — cadastra um novo perfil { name, endpoint, apiKey }.
 *
 * Permite o usuário guardar várias contas/corretoras MT5 (ex.: "B3 - XP
 * Demo", "Forex - Corretora X") e trocar qual está ativa em
 * /api/mt5/connections/[id]/activate — em vez do endpoint/chave fixos do
 * `.env`. Persistência protegida em repouso (AES-256-GCM, mesma chave
 * WR_LLM_CONFIG_ENCRYPTION_KEY já usada pelos providers de LLM); sem a
 * chave, falha fechado (503).
 *
 * Rota já protegida pelo middleware global de autenticação
 * (src/middleware.ts): tudo sob /api, exceto /api/auth/*, exige sessão
 * válida.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  listMt5ConnectionProfiles,
  createMt5ConnectionProfile,
} from '@/lib/server/mt5-connection-store';
import { isAllowedMt5McpHost } from '@/lib/server/mt5-mcp-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const profiles = await listMt5ConnectionProfiles();
  return NextResponse.json({ success: true, data: { profiles } });
}

const createSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    endpoint: z.string().trim().min(1).max(200),
    apiKey: z.string().trim().min(1).max(400),
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

export async function POST(request: NextRequest) {
  const rawBody = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Payload inválido. Informe name, endpoint e apiKey.', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  if (!isValidMt5Endpoint(parsed.data.endpoint)) {
    return NextResponse.json(
      {
        success: false,
        error: 'Endpoint deve ser http:// em loopback (127.0.0.1/localhost/::1) ou na faixa 172.16-31.x (WSL) — nenhum host remoto é aceito.',
      },
      { status: 400 }
    );
  }

  const result = await createMt5ConnectionProfile(parsed.data);
  if (!result.ok) {
    return NextResponse.json(
      {
        success: false,
        error:
          'WR_LLM_CONFIG_ENCRYPTION_KEY ausente ou com menos de 32 caracteres — cadastro de perfis MT5 desabilitado (fail-closed).',
      },
      { status: 503 }
    );
  }

  return NextResponse.json({ success: true, data: { profile: result.data } });
}
