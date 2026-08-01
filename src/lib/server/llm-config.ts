/**
 * Server-side LLM configuration — WR Trading Pro
 *
 * Única fonte de verdade para credenciais e endpoints de LLM.
 * Precedência explícita (spec docs/architecture/2026-07-31-llm-providers-expansion.md):
 *   configuração segura persistida pela UI (quando existente) > .env (bootstrap/fallback).
 * Segredos nunca chegam ao cliente; endpoints locais (Ollama/LM Studio) passam
 * por allowlist estrita — nenhum valor vindo do cliente é aceito.
 */

import { LLM_MODEL_ID_PATTERN, type LlmUiConfigurableProvider } from '../../types/llm';
import { loadPersistedProviderConfig } from './llm-secure-store';

const DEFAULT_OLLAMA_ENDPOINT = 'http://127.0.0.1:11434';
const DEFAULT_LM_STUDIO_ENDPOINT = 'http://127.0.0.1:1234/v1';

// Hosts locais permitidos para provedores locais (Ollama, LM Studio) — loopback apenas
const ALLOWED_LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Aceita apenas URLs http em loopback (localhost/127.0.0.1/::1).
 * Usada tanto para o endpoint do Ollama quanto do LM Studio — nenhum host
 * remoto é aceito, mesmo vindo de configuração persistida pela UI.
 */
export function isAllowedLocalUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' && ALLOWED_LOCAL_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Endpoint do Ollama a partir de OLLAMA_ENDPOINT (server-side).
 * Valores fora da allowlist local são descartados com fallback para o padrão
 * local — nunca se conecta a host arbitrário.
 */
export function getOllamaEndpoint(): string {
  const configured = process.env.OLLAMA_ENDPOINT?.trim();
  if (!configured) return DEFAULT_OLLAMA_ENDPOINT;

  if (!isAllowedLocalUrl(configured)) {
    console.warn(
      '[llm-config] OLLAMA_ENDPOINT fora da allowlist local (http + localhost/127.0.0.1/::1). Usando endpoint padrão local.'
    );
    return DEFAULT_OLLAMA_ENDPOINT;
  }

  return configured.replace(/\/+$/, '');
}

const DEFAULT_OLLAMA_MODEL = 'llama3.2:3b';
const MODEL_NAME_PATTERN = /^[\w][\w.\-:]{0,63}$/;

/**
 * Modelo padrão do Ollama a partir de OLLAMA_DEFAULT_MODEL (server-side).
 * Nome fora do padrão seguro é descartado com fallback para o default.
 */
export function getOllamaDefaultModel(): string {
  const configured = process.env.OLLAMA_DEFAULT_MODEL?.trim();
  if (!configured) return DEFAULT_OLLAMA_MODEL;
  if (!MODEL_NAME_PATTERN.test(configured)) {
    console.warn('[llm-config] OLLAMA_DEFAULT_MODEL inválido. Usando modelo padrão.');
    return DEFAULT_OLLAMA_MODEL;
  }
  return configured;
}

/**
 * Endpoint do LM Studio a partir de LM_STUDIO_ENDPOINT (server-side).
 * Mesma allowlist local usada para o Ollama — SSRF bloqueado por padrão.
 */
export function getLmStudioEndpointFromEnv(): string {
  const configured = process.env.LM_STUDIO_ENDPOINT?.trim();
  if (!configured) return DEFAULT_LM_STUDIO_ENDPOINT;

  if (!isAllowedLocalUrl(configured)) {
    console.warn(
      '[llm-config] LM_STUDIO_ENDPOINT fora da allowlist local (http + localhost/127.0.0.1/::1). Usando endpoint padrão local.'
    );
    return DEFAULT_LM_STUDIO_ENDPOINT;
  }

  return configured.replace(/\/+$/, '');
}

export function getLmStudioDefaultModelFromEnv(): string | undefined {
  return process.env.LM_STUDIO_DEFAULT_MODEL?.trim() || undefined;
}

export function getLmStudioApiKeyFromEnv(): string | undefined {
  return process.env.LM_STUDIO_API_KEY?.trim() || undefined;
}

export interface ServerLlmKeys {
  qwen?: string;
  groq?: string;
  manus?: string;
}

/**
 * Chaves de provedores remotos sem UI de configuração — apenas env vars
 * server-side. OpenAI/DeepSeek/OpenRouter/Anthropic/LM Studio passam por
 * resolveProviderCredential() (persistência segura + fallback .env).
 */
// NUNCA aceitar NEXT_PUBLIC_* aqui: o Next embute variáveis com esse prefixo
// no bundle do navegador se qualquer código client as referenciar — foi
// exatamente o vazamento eliminado na Fase 0 (item 7). Chaves DEVEM usar os
// nomes server-side (GROQ_API_KEY etc.); renomear no .env, não no código.
export function getServerLlmKeys(): ServerLlmKeys {
  return {
    qwen: process.env.QWEN_API_KEY?.trim() || undefined,
    groq: process.env.GROQ_API_KEY?.trim() || undefined,
    manus: process.env.MANUS_API_KEY?.trim() || undefined,
  };
}

export interface ResolvedProviderCredential {
  apiKey?: string;
  model?: string;
  /** Só populado para LM_STUDIO — endpoint local sanitizado (allowlist loopback). */
  endpoint?: string;
  /** De onde veio a credencial ativa: persistida pela UI, do .env, ou nenhuma. */
  source: 'ui' | 'env' | 'none';
}

const OPENAI_DEFAULT_MODEL_FALLBACK = 'gpt-4.1-mini';
const DEEPSEEK_DEFAULT_MODEL_FALLBACK = 'deepseek-chat';
const OPENROUTER_DEFAULT_MODEL_FALLBACK = 'openrouter/free';
const ANTHROPIC_DEFAULT_MODEL_FALLBACK = 'claude-3-5-haiku-latest';

function sanitizeModel(model: string | undefined): string | undefined {
  return model && LLM_MODEL_ID_PATTERN.test(model) ? model : undefined;
}

/**
 * Credencial efetiva de um provider configurável pela UI, já aplicando a
 * precedência: persistência segura (UI) > .env (bootstrap). Nunca lança —
 * ausência de chave de criptografia ou registro adulterado caem no .env
 * (ver loadPersistedProviderConfig em llm-secure-store.ts).
 */
export async function resolveProviderCredential(
  provider: LlmUiConfigurableProvider
): Promise<ResolvedProviderCredential> {
  const persisted = await loadPersistedProviderConfig(provider);
  const persistedModel = sanitizeModel(persisted?.model);

  switch (provider) {
    case 'OPENAI': {
      const envKey = process.env.OPENAI_API_KEY?.trim() || undefined;
      const envModel = process.env.OPENAI_DEFAULT_MODEL?.trim() || OPENAI_DEFAULT_MODEL_FALLBACK;
      if (persisted?.apiKey) return { apiKey: persisted.apiKey, model: persistedModel || envModel, source: 'ui' };
      if (envKey) return { apiKey: envKey, model: envModel, source: 'env' };
      return { model: envModel, source: 'none' };
    }
    case 'DEEPSEEK': {
      const envKey = process.env.DEEPSEEK_API_KEY?.trim() || undefined;
      const envModel = process.env.DEEPSEEK_DEFAULT_MODEL?.trim() || DEEPSEEK_DEFAULT_MODEL_FALLBACK;
      if (persisted?.apiKey) return { apiKey: persisted.apiKey, model: persistedModel || envModel, source: 'ui' };
      if (envKey) return { apiKey: envKey, model: envModel, source: 'env' };
      return { model: envModel, source: 'none' };
    }
    case 'OPENROUTER': {
      const envKey = process.env.OPENROUTER_API_KEY?.trim() || undefined;
      const envModel = process.env.OPENROUTER_DEFAULT_MODEL?.trim() || OPENROUTER_DEFAULT_MODEL_FALLBACK;
      if (persisted?.apiKey) return { apiKey: persisted.apiKey, model: persistedModel || envModel, source: 'ui' };
      if (envKey) return { apiKey: envKey, model: envModel, source: 'env' };
      return { model: envModel, source: 'none' };
    }
    case 'ANTHROPIC': {
      const envKey = process.env.ANTHROPIC_API_KEY?.trim() || undefined;
      const envModel = process.env.ANTHROPIC_DEFAULT_MODEL?.trim() || ANTHROPIC_DEFAULT_MODEL_FALLBACK;
      if (persisted?.apiKey) return { apiKey: persisted.apiKey, model: persistedModel || envModel, source: 'ui' };
      if (envKey) return { apiKey: envKey, model: envModel, source: 'env' };
      return { model: envModel, source: 'none' };
    }
    case 'LM_STUDIO': {
      const envEndpoint = getLmStudioEndpointFromEnv();
      const envModel = getLmStudioDefaultModelFromEnv();
      const envApiKey = getLmStudioApiKeyFromEnv();
      const persistedEndpoint =
        persisted?.endpoint && isAllowedLocalUrl(persisted.endpoint)
          ? persisted.endpoint.replace(/\/+$/, '')
          : undefined;
      if (persisted) {
        return {
          apiKey: persisted.apiKey || envApiKey,
          model: persistedModel || envModel,
          endpoint: persistedEndpoint || envEndpoint,
          source: 'ui',
        };
      }
      return {
        apiKey: envApiKey,
        model: envModel,
        endpoint: envEndpoint,
        source: envApiKey || envModel ? 'env' : 'none',
      };
    }
    default:
      return { source: 'none' };
  }
}
