/**
 * Server-side LLM configuration — WR Trading Pro
 *
 * Única fonte de verdade para credenciais e endpoints de LLM.
 * Segredos vêm SOMENTE de variáveis de ambiente server-side (sem NEXT_PUBLIC_).
 * O endpoint Ollama passa por allowlist local estrita para impedir SSRF:
 * nenhum valor vindo do cliente é aceito.
 */

const DEFAULT_OLLAMA_ENDPOINT = 'http://127.0.0.1:11434';

// Hosts locais permitidos para o Ollama (loopback apenas)
const ALLOWED_LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Aceita apenas URLs http em loopback (localhost/127.0.0.1/::1).
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

export interface ServerLlmKeys {
  openai?: string;
  deepseek?: string;
  qwen?: string;
  groq?: string;
  manus?: string;
}

/**
 * Chaves de provedores remotos — apenas env vars server-side.
 */
// NUNCA aceitar NEXT_PUBLIC_* aqui: o Next embute variáveis com esse prefixo
// no bundle do navegador se qualquer código client as referenciar — foi
// exatamente o vazamento eliminado na Fase 0 (item 7). Chaves DEVEM usar os
// nomes server-side (DEEPSEEK_API_KEY etc.); renomear no .env, não no código.
export function getServerLlmKeys(): ServerLlmKeys {
  return {
    openai: process.env.OPENAI_API_KEY?.trim() || undefined,
    deepseek: process.env.DEEPSEEK_API_KEY?.trim() || undefined,
    qwen: process.env.QWEN_API_KEY?.trim() || undefined,
    groq: process.env.GROQ_API_KEY?.trim() || undefined,
    manus: process.env.MANUS_API_KEY?.trim() || undefined,
  };
}
