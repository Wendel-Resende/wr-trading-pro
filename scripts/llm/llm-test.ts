/**
 * Testes de contrato e adversariais — expansão de provedores LLM
 * (spec docs/architecture/2026-07-31-llm-providers-expansion.md).
 *
 * Cobre: enum fechada de providers, allowlist local (SSRF), descoberta
 * /v1/models sanitizada, payloads OpenAI-compatible (OpenAI/LM Studio/
 * OpenRouter) e Anthropic nativo, timeout/erro HTTP/resposta malformada por
 * adapter, fallback determinístico, persistência segura (salvar/limpar/
 * rotação de chave) e rejeição adversarial de apiKey/endpoint no handler
 * HTTP real antes de qualquer chamada upstream.
 */

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { NextRequest } from 'next/server';
import { PrismaClient } from '@prisma/client';

import {
  LLM_PROVIDERS,
  LLM_UI_CONFIGURABLE_PROVIDERS,
  LLM_MODEL_ID_PATTERN,
} from '../../src/types/llm';
import {
  isAllowedLocalUrl,
  getOllamaEndpoint,
  getLmStudioEndpointFromEnv,
  resolveProviderCredential,
} from '../../src/lib/server/llm-config';
import {
  OpenAICompatibleProvider,
  AnthropicProvider,
  OllamaProvider,
  discoverLmStudioModels,
  serverLlmService,
} from '../../src/lib/server/llm-providers';
import {
  saveProviderConfig,
  clearProviderConfig,
  loadPersistedProviderConfig,
  getEncryptionKey,
  hasEncryptionKeyConfigured,
} from '../../src/lib/server/llm-secure-store';
import { POST as chatPost, GET as chatGet } from '../../src/app/api/llm/chat/route';
import { GET as configGet, POST as configPost } from '../../src/app/api/llm/config/route';

// ─── Helpers ────────────────────────────────────────────────────────────────

type Handler = (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void;

async function withMockServer<T>(handler: Handler, run: (port: number) => Promise<T>): Promise<T> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    return await run(port);
  } finally {
    (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function jsonHandler(status: number, body: unknown, capture?: { headers?: Record<string, unknown>; body?: string; url?: string }): Handler {
  return (req, res) => {
    readBody(req).then((raw) => {
      if (capture) {
        capture.headers = req.headers as Record<string, unknown>;
        capture.body = raw;
        capture.url = req.url;
      }
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  };
}

function hangHandler(): Handler {
  return () => {
    // nunca responde — simula provedor pendurado
  };
}

const SANITIZED_ENV_KEYS = [
  'OPENAI_API_KEY',
  'OPENAI_DEFAULT_MODEL',
  'DEEPSEEK_API_KEY',
  'DEEPSEEK_DEFAULT_MODEL',
  'QWEN_API_KEY',
  'GROQ_API_KEY',
  'MANUS_API_KEY',
  'OPENROUTER_API_KEY',
  'OPENROUTER_DEFAULT_MODEL',
  'OPENROUTER_APP_TITLE',
  'OPENROUTER_HTTP_REFERER',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_DEFAULT_MODEL',
  'LM_STUDIO_ENDPOINT',
  'LM_STUDIO_DEFAULT_MODEL',
  'LM_STUDIO_API_KEY',
  'OLLAMA_ENDPOINT',
  'OLLAMA_DEFAULT_MODEL',
  'WR_LLM_CONFIG_ENCRYPTION_KEY',
] as const;

/** Limpa todas as env vars de LLM antes de cada teste — determinismo total. */
function resetLlmEnv(): void {
  for (const key of SANITIZED_ENV_KEYS) delete process.env[key];
}

// ─── 1. Enum fechada de providers ──────────────────────────────────────────

function providerEnumTests(): void {
  assert.deepEqual(
    [...LLM_PROVIDERS].sort(),
    ['ANTHROPIC', 'DEEPSEEK', 'GROQ', 'LM_STUDIO', 'MANUS', 'OLLAMA', 'OPENAI', 'OPENROUTER', 'QWEN'].sort(),
    'LLM_PROVIDERS deveria conter exatamente os 9 providers (DeepSeek/Ollama preservados + LM Studio/OpenRouter/Anthropic novos)'
  );
  assert.deepEqual(
    [...LLM_UI_CONFIGURABLE_PROVIDERS].sort(),
    ['ANTHROPIC', 'DEEPSEEK', 'LM_STUDIO', 'OPENAI', 'OPENROUTER'].sort(),
    'LLM_UI_CONFIGURABLE_PROVIDERS deveria ser exatamente os 5 providers configuráveis pela UI'
  );

  assert.ok(LLM_MODEL_ID_PATTERN.test('openrouter/free'), 'model id do OpenRouter deveria ser aceito (contém "/")');
  assert.ok(LLM_MODEL_ID_PATTERN.test('claude-3-5-haiku-latest'), 'model id da Anthropic deveria ser aceito');
  assert.ok(!LLM_MODEL_ID_PATTERN.test('model with spaces'), 'model id com espaço deveria ser rejeitado');
  assert.ok(!LLM_MODEL_ID_PATTERN.test('http://evil.example/x'), 'model id em forma de URL deveria ser rejeitado (contém "://")');
  assert.ok(!LLM_MODEL_ID_PATTERN.test('model\nwith\nnewline'), 'model id com newline (injeção de header) deveria ser rejeitado');
  assert.ok(!LLM_MODEL_ID_PATTERN.test(''), 'model id vazio deveria ser rejeitado');

  console.log('enum de providers e regex de model id: OK');
}

// ─── 2. Allowlist local (SSRF) ─────────────────────────────────────────────

function allowlistTests(): void {
  assert.ok(isAllowedLocalUrl('http://localhost:11434'), 'http://localhost deveria ser permitido');
  assert.ok(isAllowedLocalUrl('http://127.0.0.1:1234/v1'), 'http://127.0.0.1 deveria ser permitido');
  assert.ok(isAllowedLocalUrl('http://[::1]:1234'), 'http://[::1] deveria ser permitido');

  assert.ok(!isAllowedLocalUrl('https://localhost:1234'), 'https (não http) deveria ser rejeitado');
  assert.ok(!isAllowedLocalUrl('http://192.168.1.10:1234'), 'IP de LAN não deveria ser permitido (SSRF)');
  assert.ok(!isAllowedLocalUrl('http://evil.example.com:1234'), 'host remoto deveria ser rejeitado (SSRF)');
  assert.ok(!isAllowedLocalUrl('http://localhost.evil.com:1234'), 'host com sufixo "localhost" não deveria enganar o match exato');
  assert.ok(!isAllowedLocalUrl('file:///etc/passwd'), 'esquema file:// deveria ser rejeitado');
  assert.ok(!isAllowedLocalUrl('not a url'), 'string malformada deveria ser rejeitada sem lançar');

  resetLlmEnv();
  assert.equal(getOllamaEndpoint(), 'http://127.0.0.1:11434', 'sem OLLAMA_ENDPOINT, default local deveria ser usado');
  assert.equal(getLmStudioEndpointFromEnv(), 'http://127.0.0.1:1234/v1', 'sem LM_STUDIO_ENDPOINT, default local deveria ser usado');

  process.env.OLLAMA_ENDPOINT = 'http://evil.example.com:9999';
  assert.equal(getOllamaEndpoint(), 'http://127.0.0.1:11434', 'OLLAMA_ENDPOINT remoto deveria cair no default local (fail-closed)');

  process.env.LM_STUDIO_ENDPOINT = 'http://evil.example.com:9999/v1';
  assert.equal(getLmStudioEndpointFromEnv(), 'http://127.0.0.1:1234/v1', 'LM_STUDIO_ENDPOINT remoto deveria cair no default local (fail-closed)');

  resetLlmEnv();
  console.log('allowlist local (Ollama/LM Studio, proteção SSRF): OK');
}

// ─── 3. Descoberta /v1/models sanitizada (LM Studio) ───────────────────────

async function lmStudioDiscoveryTests(): Promise<void> {
  await withMockServer(
    jsonHandler(200, { data: [{ id: 'model-b' }, { id: 'model-a' }, { id: 123 }, { notid: 'x' }] }),
    async (port) => {
      const models = await discoverLmStudioModels(`http://127.0.0.1:${port}`);
      assert.deepEqual(models, ['model-a', 'model-b'], 'descoberta deveria filtrar entradas sem id string e ordenar');
    }
  );

  await withMockServer(
    (req, res) => {
      res.writeHead(500);
      res.end('boom');
    },
    async (port) => {
      const models = await discoverLmStudioModels(`http://127.0.0.1:${port}`);
      assert.deepEqual(models, [], 'HTTP de erro na descoberta deveria retornar lista vazia, nunca lançar');
    }
  );

  let fetchCalled = false;
  const originalFetch = global.fetch;
  global.fetch = (async (...args: Parameters<typeof fetch>) => {
    fetchCalled = true;
    return originalFetch(...args);
  }) as typeof fetch;
  try {
    const models = await discoverLmStudioModels('http://evil.example.com:1234');
    assert.deepEqual(models, [], 'endpoint remoto deveria ser rejeitado pela allowlist');
    assert.equal(fetchCalled, false, 'endpoint remoto NUNCA deveria disparar fetch (allowlist bloqueia antes da rede)');
  } finally {
    global.fetch = originalFetch;
  }

  console.log('descoberta LM Studio /v1/models: OK (sanitizada, allowlist antes da rede)');
}

// ─── 4. Payload OpenAI-compatible (OpenAI/LM Studio/OpenRouter) ────────────

async function openAiCompatiblePayloadTests(): Promise<void> {
  // Requisição básica: Authorization presente, body no shape esperado
  const capture: { headers?: Record<string, unknown>; body?: string } = {};
  await withMockServer(
    jsonHandler(
      200,
      { choices: [{ message: { content: 'Olá!' } }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } },
      capture
    ),
    async (port) => {
      const provider = new OpenAICompatibleProvider(
        'OPENAI',
        'sk-test-key',
        `http://127.0.0.1:${port}/chat/completions`,
        'gpt-4.1-mini',
        0.1
      );
      const result = await provider.chat([{ role: 'user', content: 'oi' }], { maxTokens: 500, temperature: 0.5 });
      assert.equal(result.content, 'Olá!');
      assert.equal(result.provider, 'OPENAI');
      assert.equal(result.model, 'gpt-4.1-mini');
      assert.equal(result.usage?.totalTokens, 5);

      assert.equal(capture.headers?.authorization, 'Bearer sk-test-key', 'Authorization Bearer deveria ser enviado');
      const parsedBody = JSON.parse(capture.body!);
      assert.equal(parsedBody.model, 'gpt-4.1-mini');
      assert.equal(parsedBody.max_tokens, 500);
      assert.equal(parsedBody.temperature, 0.5);
      assert.deepEqual(parsedBody.messages, [{ role: 'user', content: 'oi' }]);

      // A resposta nunca carrega a apiKey nem headers de upstream
      const serialized = JSON.stringify(result);
      assert.ok(!serialized.includes('sk-test-key'), 'LLMResponse NUNCA deve conter a apiKey');
    }
  );

  // LM Studio: apiKey opcional — sem key configurada, nenhum header Authorization
  const lmCapture: { headers?: Record<string, unknown> } = {};
  await withMockServer(
    jsonHandler(200, { choices: [{ message: { content: 'local ok' } }] }, lmCapture),
    async (port) => {
      const provider = new OpenAICompatibleProvider(
        'LM_STUDIO',
        undefined,
        `http://127.0.0.1:${port}/chat/completions`,
        'local-model',
        0.3,
        {},
        false
      );
      assert.equal(provider.isConfigured(), true, 'LM Studio deveria estar sempre "configurado" (endpoint local com default)');
      await provider.chat([{ role: 'user', content: 'oi' }]);
      assert.equal(lmCapture.headers?.authorization, undefined, 'sem apiKey, LM Studio não deveria enviar Authorization');
    }
  );

  // OpenRouter: headers extras (X-Title/HTTP-Referer) chegam, sem segredo extra
  const orCapture: { headers?: Record<string, unknown> } = {};
  await withMockServer(
    jsonHandler(200, { choices: [{ message: { content: 'openrouter ok' } }] }, orCapture),
    async (port) => {
      const provider = new OpenAICompatibleProvider(
        'OPENROUTER',
        'sk-or-test',
        `http://127.0.0.1:${port}/chat/completions`,
        'openrouter/free',
        0.3,
        { 'X-Title': 'WR Trading Pro', 'HTTP-Referer': 'http://127.0.0.1' }
      );
      await provider.chat([{ role: 'user', content: 'oi' }]);
      assert.equal(orCapture.headers?.['x-title'], 'WR Trading Pro');
      assert.equal(orCapture.headers?.['http-referer'], 'http://127.0.0.1');
      assert.equal(orCapture.headers?.authorization, 'Bearer sk-or-test');
    }
  );

  console.log('payload OpenAI-compatible (OpenAI/LM Studio/OpenRouter): OK');
}

// ─── 5. Payload Anthropic nativo ───────────────────────────────────────────

async function anthropicPayloadTests(): Promise<void> {
  const capture: { headers?: Record<string, unknown>; body?: string } = {};
  await withMockServer(
    jsonHandler(
      200,
      { content: [{ type: 'text', text: 'Olá' }, { type: 'text', text: ' mundo' }], usage: { input_tokens: 7, output_tokens: 4 } },
      capture
    ),
    async (port) => {
      const provider = new AnthropicProvider('sk-ant-test', 'claude-3-5-haiku-latest', `http://127.0.0.1:${port}/v1/messages`);
      const result = await provider.chat(
        [
          { role: 'system', content: 'Você é um assistente de trading.' },
          { role: 'user', content: 'Qual o preço de PETR4?' },
        ],
        { maxTokens: 300, temperature: 0.4 }
      );

      assert.equal(result.content, 'Olá mundo', 'blocos de texto deveriam ser concatenados');
      assert.equal(result.provider, 'ANTHROPIC');
      assert.equal(result.usage?.promptTokens, 7);
      assert.equal(result.usage?.completionTokens, 4);
      assert.equal(result.usage?.totalTokens, 11);

      assert.equal(capture.headers?.['x-api-key'], 'sk-ant-test', 'x-api-key deveria ser enviado (não Authorization Bearer)');
      assert.equal(capture.headers?.authorization, undefined, 'Anthropic não deveria receber header Authorization');
      assert.equal(capture.headers?.['anthropic-version'], '2023-06-01');

      const body = JSON.parse(capture.body!);
      assert.equal(body.system, 'Você é um assistente de trading.', 'system deveria ir separado, não no array messages');
      assert.equal(body.max_tokens, 300, 'max_tokens é obrigatório na API nativa');
      assert.deepEqual(
        body.messages,
        [{ role: 'user', content: 'Qual o preço de PETR4?' }],
        'messages não deveria conter a role "system"'
      );
      assert.ok(body.temperature <= 1, 'temperature deveria ser clampada para o intervalo 0..1 da Anthropic');

      const serialized = JSON.stringify(result);
      assert.ok(!serialized.includes('sk-ant-test'), 'LLMResponse NUNCA deve conter a apiKey');
    }
  );

  // max_tokens obrigatório: ausência de conteúdo válido rejeita mensagens
  // só-system de forma sanitizada (nunca envia request vazio ao upstream).
  await withMockServer(hangHandler(), async (port) => {
    const provider = new AnthropicProvider('sk-ant-test', 'claude-3-5-haiku-latest', `http://127.0.0.1:${port}/v1/messages`);
    await assert.rejects(
      provider.chat([{ role: 'system', content: 'só system' }], { maxTokens: 100 }),
      /nenhuma mensagem de usuário\/assistente/,
      'sem mensagens user/assistant, deveria rejeitar antes de qualquer chamada upstream'
    );
  });

  console.log('payload Anthropic nativo (system separado, max_tokens, content[] -> texto): OK');
}

// ─── 6. Timeout / erro HTTP / resposta malformada por adapter ─────────────

async function timeoutAndErrorTests(): Promise<void> {
  // Timeout: OpenAI-compatible e Anthropic contra servidor pendurado
  await withMockServer(hangHandler(), async (port) => {
    const openai = new OpenAICompatibleProvider('OPENAI', 'k', `http://127.0.0.1:${port}/v1`, 'm');
    const t0 = Date.now();
    await assert.rejects(
      openai.chat([{ role: 'user', content: 'oi' }], { timeoutMs: 300 }),
      /timeout|abort/i,
      'OpenAICompatibleProvider deveria abortar por timeout'
    );
    assert.ok(Date.now() - t0 < 5000, 'abort deveria ocorrer perto do timeoutMs configurado');

    const anthropic = new AnthropicProvider('k', 'm', `http://127.0.0.1:${port}/v1/messages`);
    const t1 = Date.now();
    await assert.rejects(
      anthropic.chat([{ role: 'user', content: 'oi' }], { timeoutMs: 300 }),
      /timeout|abort/i,
      'AnthropicProvider deveria abortar por timeout'
    );
    assert.ok(Date.now() - t1 < 5000, 'abort deveria ocorrer perto do timeoutMs configurado');

    const ollama = new OllamaProvider(`http://127.0.0.1:${port}`, 'm');
    const t2 = Date.now();
    await assert.rejects(
      ollama.chat([{ role: 'user', content: 'oi' }], { timeoutMs: 300 }),
      /timeout|abort/i,
      'OllamaProvider deveria abortar por timeout'
    );
    assert.ok(Date.now() - t2 < 5000, 'abort deveria ocorrer perto do timeoutMs configurado');
  });

  // Erro HTTP: mensagem do provedor propagada, nunca payload bruto de upstream com stack
  await withMockServer(jsonHandler(500, { error: { message: 'quota excedida' } }), async (port) => {
    const openai = new OpenAICompatibleProvider('OPENAI', 'k', `http://127.0.0.1:${port}/v1`, 'm');
    await assert.rejects(openai.chat([{ role: 'user', content: 'oi' }]), /quota excedida/);
  });
  await withMockServer(jsonHandler(400, { error: { message: 'payload inválido' } }), async (port) => {
    const anthropic = new AnthropicProvider('k', 'm', `http://127.0.0.1:${port}/v1/messages`);
    await assert.rejects(anthropic.chat([{ role: 'user', content: 'oi' }], { maxTokens: 10 }), /payload inválido/);
  });

  // Resposta malformada: adapter rejeita de forma clara em vez de lançar TypeError opaco
  await withMockServer(jsonHandler(200, { unexpected: true }), async (port) => {
    const openai = new OpenAICompatibleProvider('OPENAI', 'k', `http://127.0.0.1:${port}/v1`, 'm');
    await assert.rejects(openai.chat([{ role: 'user', content: 'oi' }]), /resposta malformada/);
  });
  await withMockServer(jsonHandler(200, { content: [{ type: 'image', source: {} }] }), async (port) => {
    const anthropic = new AnthropicProvider('k', 'm', `http://127.0.0.1:${port}/v1/messages`);
    await assert.rejects(anthropic.chat([{ role: 'user', content: 'oi' }], { maxTokens: 10 }), /resposta malformada/);
  });

  console.log('timeout / erro HTTP / resposta malformada por adapter: OK');
}

// ─── 7. Fallback determinístico ────────────────────────────────────────────

async function fallbackTests(): Promise<void> {
  resetLlmEnv();
  await withMockServer(jsonHandler(500, { error: { message: 'lm studio indisponível' } }), async (lmPort) => {
    await withMockServer(
      jsonHandler(200, { message: { content: 'resposta do ollama' } }),
      async (ollamaPort) => {
        process.env.LM_STUDIO_ENDPOINT = `http://127.0.0.1:${lmPort}`;
        process.env.LM_STUDIO_DEFAULT_MODEL = 'lm-model';
        process.env.OLLAMA_ENDPOINT = `http://127.0.0.1:${ollamaPort}`;
        process.env.OLLAMA_DEFAULT_MODEL = 'ollama-model';

        const response = await serverLlmService.chat({
          messages: [{ role: 'user', content: 'oi' }],
          config: { provider: 'LM_STUDIO' },
        });

        assert.equal(response.provider, 'OLLAMA', 'ao falhar o provider preferido (LM_STUDIO), deveria cair para o próximo configurado no fallbackOrder (OLLAMA)');
        assert.equal(response.content, 'resposta do ollama');

        resetLlmEnv();
      }
    );
  });

  console.log('fallback determinístico entre providers configurados: OK (resposta informa o provider efetivamente usado)');
}

// ─── 8. Configuração server-side: nunca aceita NEXT_PUBLIC_* ─────────────

async function noPublicPrefixTests(): Promise<void> {
  resetLlmEnv();
  process.env.NEXT_PUBLIC_OPENAI_API_KEY = 'sk-leaked-if-used';
  process.env.NEXT_PUBLIC_ANTHROPIC_API_KEY = 'sk-leaked-if-used';

  const openai = await resolveProviderCredential('OPENAI');
  const anthropic = await resolveProviderCredential('ANTHROPIC');
  assert.equal(openai.source, 'none', 'NEXT_PUBLIC_OPENAI_API_KEY nunca deveria ser lida — apenas OPENAI_API_KEY');
  assert.equal(anthropic.source, 'none', 'NEXT_PUBLIC_ANTHROPIC_API_KEY nunca deveria ser lida — apenas ANTHROPIC_API_KEY');

  delete process.env.NEXT_PUBLIC_OPENAI_API_KEY;
  delete process.env.NEXT_PUBLIC_ANTHROPIC_API_KEY;
  resetLlmEnv();
  console.log('configuração server-side nunca aceita NEXT_PUBLIC_*: OK');
}

// ─── 9. Persistência segura: salvar / limpar / rotação de chave ───────────

async function secureStoreTests(prisma: PrismaClient): Promise<void> {
  resetLlmEnv();

  // Sem chave de criptografia: fail-closed em toda a superfície
  assert.equal(getEncryptionKey(), null);
  assert.equal(hasEncryptionKeyConfigured(), false);
  const saveWithoutKey = await saveProviderConfig('OPENAI', { apiKey: 'sk-should-not-persist' });
  assert.equal(saveWithoutKey.ok, false, 'salvar sem WR_LLM_CONFIG_ENCRYPTION_KEY deveria falhar fechado');
  const loadWithoutKey = await loadPersistedProviderConfig('OPENAI');
  assert.equal(loadWithoutKey, null, 'sem chave, carregar deveria retornar null (nunca lançar)');

  // Nada foi persistido em plaintext, mesmo com a falha acima
  const rowAfterFailedSave = await prisma.llmProviderConfig.findUnique({ where: { provider: 'OPENAI' } });
  assert.equal(rowAfterFailedSave, null, 'save sem chave não deveria criar linha nenhuma');

  process.env.WR_LLM_CONFIG_ENCRYPTION_KEY = 'a'.repeat(32);
  assert.ok(hasEncryptionKeyConfigured());

  const saveResult = await saveProviderConfig('OPENAI', { apiKey: 'sk-super-secret', model: 'gpt-4.1-mini' });
  assert.equal(saveResult.ok, true);

  const row = await prisma.llmProviderConfig.findUnique({ where: { provider: 'OPENAI' } });
  assert.ok(row, 'registro deveria existir após salvar');
  assert.ok(!row!.ciphertext.includes('sk-super-secret'), 'NUNCA persistir a apiKey em plaintext');
  assert.ok(!JSON.stringify(row).includes('sk-super-secret'), 'nenhum campo do registro deveria conter a apiKey em claro');
  assert.ok(row!.nonce.length > 0 && row!.tag.length > 0, 'nonce/tag por registro deveriam estar preenchidos');

  const loaded = await loadPersistedProviderConfig('OPENAI');
  assert.equal(loaded?.apiKey, 'sk-super-secret', 'decifragem com a chave correta deveria recuperar o valor original');
  assert.equal(loaded?.model, 'gpt-4.1-mini');

  // Merge parcial: salvar só o modelo preserva a apiKey já persistida
  await saveProviderConfig('OPENAI', { model: 'gpt-4o' });
  const mergedLoad = await loadPersistedProviderConfig('OPENAI');
  assert.equal(mergedLoad?.apiKey, 'sk-super-secret', 'atualizar apenas o modelo não deveria apagar a apiKey existente');
  assert.equal(mergedLoad?.model, 'gpt-4o');

  // Rotação de chave: chave nova não decifra registros antigos — falha fechada, nunca lança
  process.env.WR_LLM_CONFIG_ENCRYPTION_KEY = 'b'.repeat(32);
  const afterRotation = await loadPersistedProviderConfig('OPENAI');
  assert.equal(afterRotation, null, 'após rotacionar a chave, registros antigos devem ser tratados como ausentes (fail-closed), nunca lançar');

  const resolvedAfterRotation = await resolveProviderCredential('OPENAI');
  assert.equal(resolvedAfterRotation.source, 'none', 'sem conseguir decifrar após rotação e sem .env, a credencial efetiva deveria ser "none"');

  // Limpeza
  process.env.WR_LLM_CONFIG_ENCRYPTION_KEY = 'a'.repeat(32);
  await clearProviderConfig('OPENAI');
  const rowAfterClear = await prisma.llmProviderConfig.findUnique({ where: { provider: 'OPENAI' } });
  assert.equal(rowAfterClear, null, 'clear deveria remover o registro persistido');

  resetLlmEnv();
  console.log('persistência segura (AES-256-GCM): OK (salvar/merge/limpar/rotação de chave, nunca plaintext)');
}

// ─── 10. Rota /api/llm/config: status sanitizado + fail-closed + validação ─

async function configRouteTests(): Promise<void> {
  resetLlmEnv();

  // Sem chave de criptografia: GET funciona (mostra .env/none), POST save falha fechado (503)
  const getNoKey = await configGet();
  const getNoKeyBody = await getNoKey.json();
  assert.equal(getNoKeyBody.data.encryptionKeyConfigured, false);
  assert.ok(
    getNoKeyBody.data.providers.every((p: { configured: boolean; provider: string }) =>
      p.provider === 'LM_STUDIO' ? true : p.configured === false
    ),
    'sem env nem UI configuradas, providers remotos deveriam aparecer como não configurados'
  );

  const saveNoKeyReq = new NextRequest('http://localhost/api/llm/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'OPENAI', action: 'save', apiKey: 'sk-x' }),
  });
  const saveNoKeyRes = await configPost(saveNoKeyReq);
  assert.equal(saveNoKeyRes.status, 503, 'salvar sem chave de criptografia deveria falhar fechado (503)');
  const saveNoKeyBody = await saveNoKeyRes.json();
  assert.ok(/WR_LLM_CONFIG_ENCRYPTION_KEY/.test(saveNoKeyBody.error), 'mensagem deveria explicar a causa (chave ausente)');
  assert.ok(/\.env/.test(saveNoKeyBody.error), 'mensagem deveria informar que a configuração via .env continua disponível');

  process.env.WR_LLM_CONFIG_ENCRYPTION_KEY = 'c'.repeat(32);

  // Endpoint remoto para LM_STUDIO deve ser rejeitado (400), nunca persistido
  const badEndpointReq = new NextRequest('http://localhost/api/llm/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'LM_STUDIO', action: 'save', endpoint: 'http://evil.example.com:1234/v1' }),
  });
  const badEndpointRes = await configPost(badEndpointReq);
  assert.equal(badEndpointRes.status, 400);

  // endpoint só é aceito para LM_STUDIO
  const endpointOnOpenaiReq = new NextRequest('http://localhost/api/llm/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'OPENAI', action: 'save', endpoint: 'http://127.0.0.1:1234/v1' }),
  });
  assert.equal((await configPost(endpointOnOpenaiReq)).status, 400, 'endpoint em provider != LM_STUDIO deveria ser rejeitado');

  // Salvar válido -> status GET reflete configured/source=ui, sem nunca ecoar a apiKey
  const saveReq = new NextRequest('http://localhost/api/llm/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'ANTHROPIC', action: 'save', apiKey: 'sk-ant-config-route', model: 'claude-3-5-haiku-latest' }),
  });
  const saveRes = await configPost(saveReq);
  assert.equal(saveRes.status, 200);
  const saveBody = await saveRes.json();
  assert.equal(saveBody.data.configured, true);
  assert.equal(saveBody.data.source, 'ui');
  assert.equal(saveBody.data.model, 'claude-3-5-haiku-latest');
  assert.ok(!JSON.stringify(saveBody).includes('sk-ant-config-route'), 'resposta do POST NUNCA deveria ecoar a apiKey salva');

  const getAfterSave = await configGet();
  const getAfterSaveBody = await getAfterSave.json();
  const anthropicStatus = getAfterSaveBody.data.providers.find((p: { provider: string }) => p.provider === 'ANTHROPIC');
  assert.equal(anthropicStatus.configured, true);
  assert.equal(anthropicStatus.source, 'ui');
  assert.ok(!JSON.stringify(getAfterSaveBody).includes('sk-ant-config-route'), 'GET NUNCA deveria retornar a apiKey');

  // Limpar -> volta a não configurado (sem .env)
  const clearReq = new NextRequest('http://localhost/api/llm/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'ANTHROPIC', action: 'clear' }),
  });
  const clearRes = await configPost(clearReq);
  assert.equal(clearRes.status, 200);
  const clearBody = await clearRes.json();
  assert.equal(clearBody.data.configured, false);
  assert.equal(clearBody.data.source, 'none');

  // action "clear" não aceita apiKey/model/endpoint (schema rejeita)
  const clearWithExtraReq = new NextRequest('http://localhost/api/llm/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'ANTHROPIC', action: 'clear', apiKey: 'sk-x' }),
  });
  assert.equal((await configPost(clearWithExtraReq)).status, 400);

  // Provider fora da enum é rejeitado
  const badProviderReq = new NextRequest('http://localhost/api/llm/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'OLLAMA', action: 'save', apiKey: 'sk-x' }),
  });
  assert.equal((await configPost(badProviderReq)).status, 400, 'OLLAMA não é configurável pela UI — enum fechada deveria rejeitar');

  resetLlmEnv();
  console.log('rota /api/llm/config: OK (status sanitizado, fail-closed sem chave, validação de endpoint, nunca ecoa segredo)');
}

// ─── 11. Adversarial: apiKey/endpoint extra rejeitados ANTES do upstream ──

async function adversarialHttpHandlerTests(): Promise<void> {
  resetLlmEnv();

  let fetchCalled = false;
  const originalFetch = global.fetch;
  global.fetch = (async (...args: Parameters<typeof fetch>) => {
    fetchCalled = true;
    return originalFetch(...args);
  }) as typeof fetch;

  try {
    const req = new NextRequest('http://localhost/api/llm/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'oi' }],
        config: {
          provider: 'OPENAI',
          apiKey: 'sk-attacker-supplied',
          endpoint: 'http://attacker.example.com/v1/chat/completions',
        },
      }),
    });

    const res = await chatPost(req);
    assert.equal(res.status, 400, 'apiKey/endpoint extra no config deveriam ser rejeitados pelo schema estrito (400)');
    assert.equal(fetchCalled, false, 'nenhuma chamada upstream deveria ocorrer antes da validação do schema');

    const body = await res.json();
    assert.equal(body.success, false);

    // Provider fora da enum fechada também é rejeitado
    const reqBadProvider = new NextRequest('http://localhost/api/llm/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'oi' }], config: { provider: 'EVIL_PROVIDER' } }),
    });
    const resBadProvider = await chatPost(reqBadProvider);
    assert.equal(resBadProvider.status, 400, 'provider fora da enum fechada deveria ser rejeitado');
    assert.equal(fetchCalled, false);

    // timeoutMs não é um campo aceito do cliente (só provider/model/temperature/maxTokens)
    const reqTimeout = new NextRequest('http://localhost/api/llm/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'oi' }], config: { provider: 'OPENAI', timeoutMs: 1 } }),
    });
    assert.equal((await chatPost(reqTimeout)).status, 400, 'timeoutMs vindo do cliente deveria ser rejeitado pelo schema estrito');
    assert.equal(fetchCalled, false);
  } finally {
    global.fetch = originalFetch;
  }

  // GET continua funcional e nunca expõe segredo (regressão do contrato existente)
  const getRes = await chatGet();
  const getBody = await getRes.json();
  assert.equal(getBody.success, true);
  assert.ok(Array.isArray(getBody.data.providers));

  console.log('teste adversarial (handler HTTP real): OK (apiKey/endpoint/provider inválido/timeoutMs rejeitados ANTES de qualquer upstream)');
}

// ─── 12. Regressão: providers legados continuam aceitos pelo schema ───────

async function legacyProvidersRegressionTests(): Promise<void> {
  for (const provider of ['DEEPSEEK', 'OLLAMA', 'QWEN', 'GROQ', 'MANUS']) {
    const req = new NextRequest('http://localhost/api/llm/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'oi' }], config: { provider } }),
    });
    const res = await chatPost(req);
    // Sem credenciais configuradas no ambiente de teste, a chamada real falha (502) —
    // o que importa aqui é que o schema aceitou o provider legado (não 400 de validação).
    assert.notEqual(res.status, 400, `provider legado ${provider} não deveria ser rejeitado pelo schema estrito`);
  }
  console.log('regressão de providers legados (DeepSeek/Ollama/Qwen/Groq/Manus) no schema do chat: OK');
}

// ─── main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  providerEnumTests();
  allowlistTests();
  await lmStudioDiscoveryTests();
  await openAiCompatiblePayloadTests();
  await anthropicPayloadTests();
  await timeoutAndErrorTests();
  await fallbackTests();
  await noPublicPrefixTests();
  await adversarialHttpHandlerTests();
  await legacyProvidersRegressionTests();

  const prisma = new PrismaClient();
  try {
    await secureStoreTests(prisma);
    await configRouteTests();
  } finally {
    await prisma.$disconnect();
  }

  console.log('Expansão de provedores LLM — TODOS OS TESTES PASSARAM');
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
