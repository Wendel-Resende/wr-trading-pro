/**
 * Cliente MCP nativo do MT5 (build 6060+) — WR Trading Pro
 *
 * Usa @modelcontextprotocol/sdk do lado cliente — a mesma lib já usada do
 * lado servidor em src/mcp/pilot/server.ts (StreamableHTTPServerTransport).
 * `client.connect(transport)` cuida do handshake completo (initialize +
 * notifications/initialized) e da sessão (Mcp-Session-Id) internamente —
 * não é reimplementado na mão aqui.
 *
 * Nunca importado por código que roda no browser: só por
 * src/app/api/mt5/mcp/**. O Bearer (MT5_MCP_API_KEY) nunca sai deste
 * módulo — vai só no header Authorization da requisição HTTP ao MT5.
 *
 * Quirk conhecido do build 6060 (documentado pelo próprio fornecedor da
 * config do Hermes): o servidor pode responder "session not initialized"
 * mesmo após um handshake aparentemente bem-sucedido. `callMt5Tool`/
 * `listMt5Tools` tratam isso descartando a sessão e tentando reconectar
 * UMA vez antes de desistir — nunca mais que isso, para não mascarar uma
 * falha real como retry silencioso infinito.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { getMt5McpConfig, type Mt5McpConfig } from './mt5-mcp-config';
import { MT5_MCP_ERROR_MESSAGES, type Mt5McpErrorCode, type Mt5McpErrorPayload } from '../../types/mt5-mcp';

const CONNECT_TIMEOUT_MS = 10_000;
const CALL_TIMEOUT_MS = 15_000;

export class Mt5McpError extends Error {
  readonly code: Mt5McpErrorCode;

  constructor(code: Mt5McpErrorCode, message: string = MT5_MCP_ERROR_MESSAGES[code]) {
    super(message);
    this.name = 'Mt5McpError';
    this.code = code;
  }

  toPayload(): Mt5McpErrorPayload {
    return { code: this.code, message: this.message };
  }
}

function isSessionErrorMessage(raw: string): boolean {
  return /session/i.test(raw) || raw.includes('-32600');
}

function isAuthErrorMessage(raw: string): boolean {
  return /\b401\b|\b403\b|unauthorized|forbidden/i.test(raw);
}

/**
 * Detecta "terminal aberto mas sem conta logada" — o texto exato não é
 * documentado publicamente pelo build 6060 (mesma ressalva de
 * isSessionErrorMessage), então cobre as variações mais prováveis em
 * inglês/português. Ajustar aqui caso o smoke-test real (Guardião com
 * MT5_MCP_API_KEY de verdade) mostre outro texto.
 */
function isTerminalDisconnectedMessage(raw: string): boolean {
  return /not logged in|no account|no active account|não logad[ao]|nenhuma conta|not connected to (a |the )?(trade )?account/i.test(
    raw
  );
}

/**
 * Detecta falha de validação de structuredContent contra o outputSchema
 * declarado pela tool (SDK @modelcontextprotocol/sdk, client/index.js:
 * callTool()) — build 6061 pode declarar outputSchema que não bate com o
 * que a tool realmente devolve (ex.: campo extra não documentado). Sem
 * isso, essa falha caía no fallback genérico MT5_MCP_UNREACHABLE, que
 * afirma incorretamente que o terminal/servidor não está acessível.
 */
function isSchemaValidationErrorMessage(raw: string): boolean {
  return /output schema|structured content/i.test(raw) || raw.includes('-32602');
}

/** Nunca propaga a mensagem bruta do SDK/rede para o chamador — só a classificação. */
function classifyUnknownError(error: unknown): Mt5McpError {
  if (error instanceof Mt5McpError) return error;
  const raw = error instanceof Error ? error.message : String(error);
  if (isAuthErrorMessage(raw)) return new Mt5McpError('MT5_MCP_AUTH_FAILED');
  if (isSessionErrorMessage(raw)) return new Mt5McpError('MT5_MCP_SESSION_ERROR');
  if (isTerminalDisconnectedMessage(raw)) return new Mt5McpError('MT5_MCP_TERMINAL_DISCONNECTED');
  if (isSchemaValidationErrorMessage(raw)) return new Mt5McpError('MT5_MCP_TOOL_ERROR');
  return new Mt5McpError('MT5_MCP_UNREACHABLE');
}

interface ActiveClient {
  readonly client: Client;
  readonly config: Mt5McpConfig;
}

let active: ActiveClient | null = null;

async function closeQuietly(client: Client): Promise<void> {
  try {
    await client.close();
  } catch {
    // Sessão já obsoleta (config mudou ou erro de sessão) — erro de close não importa aqui.
  }
}

async function connectNewClient(config: Mt5McpConfig): Promise<Client> {
  const client = new Client({ name: 'wr-trading-pro', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(config.endpoint), {
    requestInit: { headers: { Authorization: `Bearer ${config.apiKey}` } },
  });
  try {
    await client.connect(transport, { timeout: CONNECT_TIMEOUT_MS });
  } catch (error) {
    throw classifyUnknownError(error);
  }
  return client;
}

/** Reaproveita o client ativo se a config não mudou; senão fecha e reconecta. */
async function ensureClient(): Promise<Client> {
  const config = getMt5McpConfig();
  if (!config) throw new Mt5McpError('MT5_MCP_NOT_CONFIGURED');

  if (active && active.config.endpoint === config.endpoint && active.config.apiKey === config.apiKey) {
    return active.client;
  }
  if (active) {
    const stale = active.client;
    active = null;
    await closeQuietly(stale);
  }
  const client = await connectNewClient(config);
  active = { client, config };
  return client;
}

/** Descarta o client ativo — a próxima chamada reconecta com sessão nova. */
function resetClient(): void {
  const stale = active;
  active = null;
  if (stale) void closeQuietly(stale.client);
}

export interface Mt5McpToolResult {
  readonly content: ReadonlyArray<{ type: string; text?: string; [key: string]: unknown }>;
  readonly structuredContent?: Record<string, unknown>;
}

async function callToolOnce(name: string, args: Record<string, unknown>): Promise<Mt5McpToolResult> {
  const client = await ensureClient();
  // `client.callTool()` valida structuredContent contra o outputSchema
  // declarado pela tool — e o servidor MT5 real declara outputSchema que não
  // bate com o que várias tools de fato devolvem (confirmado por sonda real:
  // get_workspace_info falha nessa validação embora a resposta seja válida).
  // `client.request()` faz a MESMA chamada JSON-RPC tools/call sem essa
  // camada extra de validação — a resposta ainda é parseada pelo
  // CallToolResultSchema do protocolo, só pula o schema PRÓPRIO de cada tool.
  const result = await client.request(
    { method: 'tools/call', params: { name, arguments: args } },
    CallToolResultSchema,
    { timeout: CALL_TIMEOUT_MS }
  );
  if (result.isError) {
    const text = Array.isArray(result.content)
      ? result.content.find((c): c is { type: 'text'; text: string } => c?.type === 'text' && typeof c.text === 'string')
          ?.text
      : undefined;
    // O quirk "session not initialized" do build 6060 pode chegar como erro
    // de tool (isError:true) em vez de erro de protocolo JSON-RPC — o
    // wire format exato do servidor nativo não é garantido pela doc. Trata
    // os dois formatos igual, para o retry único de sessão funcionar
    // independentemente de qual forma o servidor realmente usa.
    if (text && isSessionErrorMessage(text)) {
      throw new Mt5McpError('MT5_MCP_SESSION_ERROR', text);
    }
    if (text && isTerminalDisconnectedMessage(text)) {
      throw new Mt5McpError('MT5_MCP_TERMINAL_DISCONNECTED', text);
    }
    throw new Mt5McpError('MT5_MCP_TOOL_ERROR', text || MT5_MCP_ERROR_MESSAGES.MT5_MCP_TOOL_ERROR);
  }
  return {
    content: (result.content ?? []) as Mt5McpToolResult['content'],
    structuredContent: result.structuredContent as Record<string, unknown> | undefined,
  };
}

/**
 * Chama uma tool do MCP nativo pelo nome real (já resolvido — ver
 * mt5-mcp-tools.ts para o mapeamento tolerante nome-lógico → nome-real).
 */
export async function callMt5Tool(name: string, args: Record<string, unknown> = {}): Promise<Mt5McpToolResult> {
  try {
    return await callToolOnce(name, args);
  } catch (error) {
    const classified = classifyUnknownError(error);
    if (classified.code !== 'MT5_MCP_SESSION_ERROR') throw classified;

    resetClient();
    try {
      return await callToolOnce(name, args);
    } catch (retryError) {
      throw classifyUnknownError(retryError);
    }
  }
}

export interface Mt5McpToolDescriptor {
  readonly name: string;
  readonly description?: string;
}

async function listToolsOnce(): Promise<Mt5McpToolDescriptor[]> {
  const client = await ensureClient();
  const result = await client.listTools(undefined, { timeout: CALL_TIMEOUT_MS });
  return result.tools.map((t) => ({ name: t.name, description: t.description }));
}

export async function listMt5Tools(): Promise<Mt5McpToolDescriptor[]> {
  try {
    return await listToolsOnce();
  } catch (error) {
    const classified = classifyUnknownError(error);
    if (classified.code !== 'MT5_MCP_SESSION_ERROR') throw classified;

    resetClient();
    try {
      return await listToolsOnce();
    } catch (retryError) {
      throw classifyUnknownError(retryError);
    }
  }
}

/** Exposto só para os testes — nunca chamado em código de produção. */
export function __resetMt5McpClientForTests(): void {
  resetClient();
}

/**
 * Exposto só para os testes — nunca chamado em código de produção. Delega
 * diretamente ao classificador privado, sem alterar seu comportamento; usado
 * para testar a precedência de classifyUnknownError com mensagens sintéticas
 * (sem precisar reproduzir round-trip real via mock server).
 */
export function __classifyUnknownErrorForTests(error: unknown): Mt5McpError {
  return classifyUnknownError(error);
}
