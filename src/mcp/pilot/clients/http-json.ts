/**
 * Cliente HTTP JSON interno do wr-mcp-pilot: as tools proxy (CVM rico,
 * monitoramento/alertas, ações de agent-run) chamam as próprias rotas
 * Next.js autenticadas com `WR_SERVICE_TOKEN` (Bearer) — nunca acessam
 * Prisma/serviços diretamente daqui. Timeout via `AbortSignal.timeout`
 * (default 30s); qualquer falha vira `ReadModelError` sanitizado.
 */
import { ReadModelError } from '../../../application/read-models-v1/errors';

export interface HttpJson {
  get(path: string): Promise<unknown>;
  post(path: string, body: unknown): Promise<unknown>;
  del(path: string): Promise<unknown>;
}

export function createHttpJson(baseUrl: string, opts?: { bearer?: string; timeoutMs?: number }): HttpJson {
  const timeoutMs = opts?.timeoutMs ?? 30_000;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts?.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  async function call(method: string, path: string, body?: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const aborted = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      throw new ReadModelError(aborted ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_ERROR', `falha ao chamar ${path}: ${aborted ? `timeout após ${timeoutMs}ms` : 'serviço indisponível'}`);
    }
    const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok) {
      const message = typeof json?.error === 'string' ? json.error : ((json?.error as Record<string, unknown> | undefined)?.message as string | undefined) ?? `HTTP ${response.status}`;
      throw new ReadModelError('UPSTREAM_ERROR', `${path}: ${message}`);
    }
    return json;
  }
  return {
    get: (p) => call('GET', p),
    post: (p, b) => call('POST', p, b),
    del: (p) => call('DELETE', p),
  };
}
