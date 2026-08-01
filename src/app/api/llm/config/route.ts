/**
 * Configuração de provedores LLM pela plataforma — WR Trading Pro
 *
 * GET  /api/llm/config — status sanitizado dos providers configuráveis pela
 *      UI (OpenAI, DeepSeek, OpenRouter, Anthropic, LM Studio): apenas
 *      provider/displayName/configured/source/modelo/endpoint local — nunca
 *      apiKey, ciphertext, nonce, Authorization ou payload de upstream.
 * POST /api/llm/config — salva ou limpa a configuração de um provider.
 *      Persistência protegida em repouso (AES-256-GCM sob
 *      WR_LLM_CONFIG_ENCRYPTION_KEY); sem a chave, falha fechado (503) e a
 *      resposta explica que a configuração server-side/.env continua
 *      disponível.
 *
 * Rota já protegida pelo middleware global de autenticação (src/middleware.ts):
 * tudo sob /api, exceto /api/auth/*, exige sessão válida.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  LLM_UI_CONFIGURABLE_PROVIDERS,
  LLM_MODEL_ID_PATTERN,
  LLM_PROVIDER_DISPLAY_NAMES,
  type LlmProviderStatus,
  type LlmUiConfigurableProvider,
} from '@/types/llm';
import { resolveProviderCredential, isAllowedLocalUrl } from '@/lib/server/llm-config';
import { saveProviderConfig, clearProviderConfig, hasEncryptionKeyConfigured } from '@/lib/server/llm-secure-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function buildStatus(provider: LlmUiConfigurableProvider): Promise<LlmProviderStatus> {
  const resolved = await resolveProviderCredential(provider);
  // LM Studio é local: sempre "configurado" via endpoint com default seguro,
  // igual ao Ollama — não depende de apiKey (opcional para LM Studio).
  const configured = provider === 'LM_STUDIO' ? true : resolved.source !== 'none';

  return {
    provider,
    displayName: LLM_PROVIDER_DISPLAY_NAMES[provider],
    configured,
    source: resolved.source,
    model: resolved.model,
    endpoint: provider === 'LM_STUDIO' ? resolved.endpoint : undefined,
  };
}

export async function GET() {
  try {
    const statuses = await Promise.all(LLM_UI_CONFIGURABLE_PROVIDERS.map(buildStatus));
    return NextResponse.json({
      success: true,
      data: {
        providers: statuses,
        encryptionKeyConfigured: hasEncryptionKeyConfigured(),
      },
    });
  } catch (error) {
    console.error('[api/llm/config] GET error:', error);
    return NextResponse.json({ success: false, error: 'Não foi possível carregar a configuração.' }, { status: 500 });
  }
}

const saveConfigSchema = z
  .object({
    provider: z.enum(LLM_UI_CONFIGURABLE_PROVIDERS),
    action: z.enum(['save', 'clear']),
    apiKey: z.string().trim().min(1).max(400).optional(),
    model: z.string().trim().regex(LLM_MODEL_ID_PATTERN, 'Modelo inválido').max(128).optional(),
    endpoint: z.string().trim().max(200).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.endpoint !== undefined && data.provider !== 'LM_STUDIO') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'endpoint só é aceito para LM_STUDIO',
        path: ['endpoint'],
      });
    }
    if (data.action === 'clear' && (data.apiKey !== undefined || data.model !== undefined || data.endpoint !== undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'action "clear" não aceita apiKey/model/endpoint',
        path: ['action'],
      });
    }
  });

export async function POST(request: NextRequest) {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'JSON inválido.' }, { status: 400 });
  }

  const parsed = saveConfigSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Payload inválido para configuração de LLM', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { provider, action, apiKey, model, endpoint } = parsed.data;

  if (action === 'clear') {
    await clearProviderConfig(provider);
    const status = await buildStatus(provider);
    return NextResponse.json({ success: true, data: status });
  }

  if (endpoint !== undefined && !isAllowedLocalUrl(endpoint)) {
    return NextResponse.json(
      {
        success: false,
        error: 'Endpoint do LM Studio deve ser http(s) em localhost/127.0.0.1/::1 — nenhum host remoto é aceito.',
      },
      { status: 400 }
    );
  }

  if (!apiKey && !model && !endpoint) {
    return NextResponse.json(
      { success: false, error: 'Informe ao menos um campo para salvar (apiKey, model ou endpoint).' },
      { status: 400 }
    );
  }

  const result = await saveProviderConfig(provider, { apiKey, model, endpoint });
  if (!result.ok) {
    return NextResponse.json(
      {
        success: false,
        error:
          'WR_LLM_CONFIG_ENCRYPTION_KEY ausente ou com menos de 32 caracteres — configuração via UI desabilitada ' +
          '(fail-closed). A configuração server-side via .env continua disponível.',
      },
      { status: 503 }
    );
  }

  const status = await buildStatus(provider);
  return NextResponse.json({ success: true, data: status });
}
