/** Envs do wr-mcp-pilot. Fail-closed: sem WR_MCP_HTTP_TOKEN (>=32) não sobe. */
const MIN_TOKEN = 32;

export class PilotConfigError extends Error {
  constructor(message: string) { super(message); this.name = 'PilotConfigError'; }
}

export interface PilotConfig {
  readonly host: string;
  readonly port: number;
  readonly token: string;
  readonly nextBaseUrl: string;
  readonly serviceToken: string;
  readonly spreadApiUrl: string;
  readonly volatilityApiUrl: string;
  readonly bridgeUrl: string;
}

export function resolvePilotConfig(env: NodeJS.ProcessEnv = process.env): PilotConfig {
  const token = env.WR_MCP_HTTP_TOKEN?.trim() ?? '';
  if (token.length < MIN_TOKEN) {
    throw new PilotConfigError(`WR_MCP_HTTP_TOKEN obrigatório (>= ${MIN_TOKEN} chars): servidor não iniciado`);
  }
  const serviceToken = env.WR_SERVICE_TOKEN?.trim() ?? '';
  if (serviceToken.length < MIN_TOKEN) {
    throw new PilotConfigError(`WR_SERVICE_TOKEN obrigatório (>= ${MIN_TOKEN} chars) para chamar as APIs do Next`);
  }
  const rawPort = env.WR_MCP_HTTP_PORT;
  const port = rawPort === undefined || rawPort === '' ? 8790 : Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new PilotConfigError(`WR_MCP_HTTP_PORT inválido: "${rawPort}"`);
  }
  return Object.freeze({
    host: env.WR_MCP_HTTP_HOST?.trim() || '127.0.0.1',
    port,
    token,
    serviceToken,
    nextBaseUrl: env.WR_MCP_NEXT_BASE_URL?.trim() || 'http://127.0.0.1:3001',
    spreadApiUrl: env.WR_MCP_SPREAD_API_URL?.trim() || 'http://127.0.0.1:5000',
    volatilityApiUrl: env.WR_MCP_VOLATILITY_API_URL?.trim() || 'http://127.0.0.1:5555',
    bridgeUrl: env.WR_MCP_BRIDGE_URL?.trim() || 'ws://127.0.0.1:8766',
  });
}
