/**
 * Server-side MT5 MCP nativo config — WR Trading Pro
 *
 * Único ponto de leitura de MT5_MCP_ENDPOINT/MT5_MCP_API_KEY/
 * MT5_MCP_POLL_INTERVAL_MS. Fail-closed: sem MT5_MCP_API_KEY,
 * getMt5McpConfig() retorna null e nenhuma chamada de rede é tentada — os
 * chamadores devem tratar isso como MT5_MCP_NOT_CONFIGURED, nunca inferir
 * "desconectado" a partir de um objeto parcial.
 */

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

function resolveEndpoint(): string {
  const configured = process.env.MT5_MCP_ENDPOINT?.trim();
  if (!configured) return DEFAULT_ENDPOINT;
  try {
    const url = new URL(configured);
    if (url.protocol !== 'http:' || !isAllowedMt5McpHost(url.hostname)) {
      console.warn(
        '[mt5-mcp-config] MT5_MCP_ENDPOINT fora da allowlist (loopback ou 172.16-31.x). Usando endpoint padrão local.'
      );
      return DEFAULT_ENDPOINT;
    }
    return configured.replace(/\/+$/, '');
  } catch {
    console.warn('[mt5-mcp-config] MT5_MCP_ENDPOINT inválido. Usando endpoint padrão local.');
    return DEFAULT_ENDPOINT;
  }
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

/** Config efetiva, ou null (fail-closed) quando MT5_MCP_API_KEY está ausente. */
export function getMt5McpConfig(): Mt5McpConfig | null {
  const apiKey = process.env.MT5_MCP_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    endpoint: resolveEndpoint(),
    apiKey,
    pollIntervalMs: resolvePollIntervalMs(),
  };
}

export function hasMt5McpConfigured(): boolean {
  return getMt5McpConfig() !== null;
}
