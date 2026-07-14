/**
 * Resolves WR_MCP_* configuration from `process.env`. Adapter boundary —
 * the MCP core (server.ts, tools/*) never reads `process.env` directly.
 * Fail-closed: `http` transport without a token throws instead of
 * silently falling back to an unauthenticated bind.
 */

export type McpTransport = 'stdio' | 'http';

export interface McpStdioConfig {
  readonly transport: 'stdio';
}

export interface McpHttpConfig {
  readonly transport: 'http';
  readonly port: number;
  readonly token: string;
}

export type McpConfig = McpStdioConfig | McpHttpConfig;

export class McpConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpConfigError';
  }
}

function parseTransport(raw: string | undefined): McpTransport {
  if (raw === undefined || raw === '') return 'stdio';
  if (raw === 'stdio' || raw === 'http') return raw;
  throw new McpConfigError(`WR_MCP_TRANSPORT inválido: "${raw}" (esperado "stdio" ou "http")`);
}

export function resolveMcpConfigFromEnv(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const transport = parseTransport(env.WR_MCP_TRANSPORT);

  if (transport === 'stdio') {
    return { transport: 'stdio' };
  }

  const token = env.WR_MCP_HTTP_TOKEN;
  if (!token) {
    throw new McpConfigError(
      'WR_MCP_TRANSPORT=http exige WR_MCP_HTTP_TOKEN (fail-closed): servidor não iniciado',
    );
  }

  const rawPort = env.WR_MCP_HTTP_PORT;
  const port = rawPort === undefined || rawPort === '' ? 8787 : Number(rawPort);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new McpConfigError(`WR_MCP_HTTP_PORT inválido: "${rawPort}"`);
  }

  return { transport: 'http', port, token };
}
