import assert from 'node:assert/strict';
import { OpenAICompatibleProvider } from '../../src/lib/server/llm-providers';

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | null = null;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      choices: [{ message: { content: '{"action":"HOLD"}' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  try {
    const provider = new OpenAICompatibleProvider('LM_STUDIO', undefined, 'http://127.0.0.1:1234/v1/chat/completions', 'google/gemma-4-e4b', 0.3, {}, false);
    await provider.chat([{ role: 'user', content: 'responda JSON' }], { reasoningEffort: 'none' });
    assert.ok(requestBody, 'o provider deve enviar um corpo JSON');
    const captured = requestBody as unknown as Record<string, unknown>;
    assert.equal(captured.reasoning_effort, 'none', 'LM Studio deve receber reasoning_effort=none para respostas estruturadas');
    console.log('LM Studio: reasoning_effort=none enviado para resposta estruturada');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
