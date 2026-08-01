import { NextResponse } from 'next/server';
import { serverLlmService, discoverLmStudioModels } from '@/lib/server/llm-providers';
import { getOllamaEndpoint, getOllamaDefaultModel, resolveProviderCredential } from '@/lib/server/llm-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Provedores LLM configurados no servidor, modelos Ollama instalados e
 * modelos descobertos no LM Studio local. Somente leitura; nenhum segredo é
 * exposto (apenas nomes/defaults não secretos). Endpoints locais vêm da
 * allowlist server-side — nada do cliente.
 */
export async function GET() {
  try {
    const allProviders = await serverLlmService.getAvailableProviders();
    const configuredFlags = await Promise.all(
      allProviders.map((p) => serverLlmService.isProviderConfigured(p))
    );
    const providers = allProviders.filter((_, i) => configuredFlags[i]);
    const configurableProviders = ['OPENAI', 'DEEPSEEK', 'OPENROUTER', 'ANTHROPIC', 'LM_STUDIO'] as const;
    const providerConfigured: Record<string, boolean> = Object.fromEntries(
      configurableProviders.map((provider) => [provider, providers.includes(provider)])
    );
    const visibleProviders = Array.from(new Set([...configurableProviders, ...providers]));

    let ollamaModels: string[] = [];
    if (providers.includes('OLLAMA')) {
      try {
        const res = await fetch(`${getOllamaEndpoint()}/api/tags`, {
          signal: AbortSignal.timeout(3000),
        });
        if (res.ok) {
          const data = (await res.json()) as { models?: { name: string }[] };
          ollamaModels = (data.models ?? []).map((m) => m.name).sort();
        }
      } catch {
        // Ollama fora do ar: provider listado, modelos vazios
      }
    }

    let lmStudioModels: string[] = [];
    let lmStudioDefaultModel: string | undefined;
    if (providers.includes('LM_STUDIO')) {
      const lmStudio = await resolveProviderCredential('LM_STUDIO');
      lmStudioDefaultModel = lmStudio.model;
      if (lmStudio.endpoint) {
        lmStudioModels = await discoverLmStudioModels(lmStudio.endpoint);
      }
    }

    // Defaults são nomes de modelos, nunca credenciais ou endpoints.
    const modelDefaults: Record<string, string | null> = {};
    await Promise.all(
      providers.map(async (provider) => {
        if (
          provider !== 'OPENAI' &&
          provider !== 'DEEPSEEK' &&
          provider !== 'LM_STUDIO' &&
          provider !== 'OPENROUTER' &&
          provider !== 'ANTHROPIC'
        ) return;
        const resolved = await resolveProviderCredential(provider);
        modelDefaults[provider] = resolved.model ?? null;
      })
    );

    return NextResponse.json({
      providers: visibleProviders,
      providerConfigured,
      ollama: { models: ollamaModels, defaultModel: getOllamaDefaultModel() },
      lmStudio: { models: lmStudioModels, defaultModel: lmStudioDefaultModel ?? null },
      modelDefaults,
    });
  } catch (error) {
    console.error('[api/llm/providers]', error);
    return NextResponse.json({ error: 'Não foi possível listar provedores.' }, { status: 500 });
  }
}
