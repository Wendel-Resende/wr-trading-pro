import { NextResponse } from 'next/server';
import { serverLlmService } from '@/lib/server/llm-providers';
import { getOllamaEndpoint, getOllamaDefaultModel } from '@/lib/server/llm-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Provedores LLM configurados no servidor e modelos Ollama instalados.
 * Somente leitura; nenhum segredo é exposto (apenas nomes). O endpoint do
 * Ollama vem da allowlist server-side — nada do cliente.
 */
export async function GET() {
  try {
    const providers = serverLlmService
      .getAvailableProviders()
      .filter((p) => serverLlmService.isProviderConfigured(p));

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

    return NextResponse.json({
      providers,
      ollama: { models: ollamaModels, defaultModel: getOllamaDefaultModel() },
    });
  } catch (error) {
    console.error('[api/llm/providers]', error);
    return NextResponse.json({ error: 'Não foi possível listar provedores.' }, { status: 500 });
  }
}
