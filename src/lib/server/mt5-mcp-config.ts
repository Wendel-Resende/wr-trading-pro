/**
 * Server-side MT5 MCP nativo config — WR Trading Pro
 *
 * Único ponto de resolução de endpoint/API key/intervalo de polling.
 * Precedência (2026-08-02, suporte a múltiplas contas/corretoras): perfil
 * ATIVO persistido via UI (`mt5-connection-store.ts`, cadastrado em
 * Configurações) > `.env` (MT5_MCP_ENDPOINT/MT5_MCP_API_KEY, bootstrap/
 * compat). Fail-closed: sem perfil ativo E sem MT5_MCP_API_KEY no .env,
 * `getMt5McpConfig()` resolve para null e nenhuma chamada de rede é
 * tentada — os chamadores devem tratar isso como MT5_MCP_NOT_CONFIGURED,
 * nunca inferir "desconectado" a partir de um objeto parcial.
 */

import { getActiveMt5ConnectionSecrets } from './mt5-connection-store';

const DEFAULT_ENDPOINT = 'http://127.0.0.1:22346/mcp';
export const DEFAULT_POLL_INTERVAL_MS = 1500;
const MIN_POLL_INTERVAL_MS = 500;
const MAX_POLL_INTERVAL_MS = 30_000;

export interface Mt5McpConfig {
  readonly endpoint: string;
  readonly apiKey: string;
  readonly pollIntervalMs: number;
}

/**
 * Allowlist do endpoint: loopback (onde o MT5 nativo roda de verdade no
 * Windows) ou a faixa privada do adaptador vEthernet do WSL (172.16.0.0/12,
 * usada só para desenvolvimento via proxy — mesma faixa já usada pelo MCP
 * Piloto em electron/main.ts). Nenhum outro host é aceito, mesmo vindo de
 * env — proteção contra SSRF.
 */
export function isAllowedMt5McpHost(hostname: string): boolean {
  if (hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]' || hostname === 'localhost') {
    return true;
  }
  const parts = hostname.split('.');
  if (parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p))) {
    const [a, b] = parts.map(Number);
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  return false;
}

/** Valida um endpoint (env ou perfil persistido) contra a allowlist; retorna null se inválido/fora da allowlist. */
function validateEndpoint(raw: string, sourceLabel: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' || !isAllowedMt5McpHost(url.hostname)) {
      console.warn(`[mt5-mcp-config] ${sourceLabel} fora da allowlist (loopback ou 172.16-31.x). Ignorando.`);
      return null;
    }
    return raw.replace(/\/+$/, '');
  } catch {
    console.warn(`[mt5-mcp-config] ${sourceLabel} inválido. Ignorando.`);
    return null;
  }
}

function resolveEndpointFromEnv(): string {
  const configured = process.env.MT5_MCP_ENDPOINT?.trim();
  if (!configured) return DEFAULT_ENDPOINT;
  return validateEndpoint(configured, 'MT5_MCP_ENDPOINT') ?? DEFAULT_ENDPOINT;
}

function resolvePollIntervalMs(): number {
  const raw = process.env.MT5_MCP_POLL_INTERVAL_MS?.trim();
  if (!raw) return DEFAULT_POLL_INTERVAL_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < MIN_POLL_INTERVAL_MS || parsed > MAX_POLL_INTERVAL_MS) {
    console.warn(
      `[mt5-mcp-config] MT5_MCP_POLL_INTERVAL_MS inválido (esperado ${MIN_POLL_INTERVAL_MS}-${MAX_POLL_INTERVAL_MS}). Usando default.`
    );
    return DEFAULT_POLL_INTERVAL_MS;
  }
  return parsed;
}

/**
 * Config efetiva. Precedência: perfil ativo persistido (Configurações >
 * Conexões MT5) > `.env` (MT5_MCP_ENDPOINT/MT5_MCP_API_KEY). Null
 * (fail-closed) quando nenhuma das duas fontes resolve uma API key válida —
 * nunca finge configurado.
 */
export async function getMt5McpConfig(): Promise<Mt5McpConfig | null> {
  const active = await getActiveMt5ConnectionSecrets();
  if (active) {
    const endpoint = validateEndpoint(active.endpoint, `perfil de conexão "${active.profileId}"`);
    if (endpoint) {
      return { endpoint, apiKey: active.apiKey, pollIntervalMs: resolvePollIntervalMs() };
    }
    console.warn('[mt5-mcp-config] Perfil ativo com endpoint inválido — caindo para .env.');
  }

  const apiKey = process.env.MT5_MCP_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    endpoint: resolveEndpointFromEnv(),
    apiKey,
    pollIntervalMs: resolvePollIntervalMs(),
  };
}

export async function hasMt5McpConfigured(): Promise<boolean> {
  return (await getMt5McpConfig()) !== null;
}
