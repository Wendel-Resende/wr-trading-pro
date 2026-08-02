/**
 * Contrato de erro sanitizado — MT5 MCP nativo (build 6060+) — WR Trading Pro
 *
 * Compartilhado entre server (src/lib/server/mt5-mcp-*.ts, src/app/api/mt5/mcp/**)
 * e client (mt5Service.ts, componentes de UI) para que toda falha do MCP
 * nativo apareça de forma acionável, nunca como um "erro genérico" opaco.
 *
 * Nunca inclui: Bearer token, envelope JSON-RPC bruto, stack trace, ou
 * qualquer detalhe de rede que não ajude o usuário a agir.
 */

export const MT5_MCP_ERROR_CODES = [
  /** MT5_MCP_API_KEY ausente/curta no servidor — fail-closed, nunca finge conectar. */
  'MT5_MCP_NOT_CONFIGURED',
  /** Endpoint configurado não responde (terminal fechado, servidor MCP desligado nas Options, rede). */
  'MT5_MCP_UNREACHABLE',
  /** Handshake OK mas a sessão não ficou associada (ex.: "session not initialized" do build 6060). */
  'MT5_MCP_SESSION_ERROR',
  /** Bearer rejeitado pelo servidor nativo (401/403). */
  'MT5_MCP_AUTH_FAILED',
  /** tools/list não expõe a tool esperada para esta capability — versão do MT5 pode não suportar. */
  'MT5_MCP_TOOL_MISSING',
  /** Handshake e sessão OK, mas o terminal não está logado numa conta (nenhuma conta ativa na GUI). */
  'MT5_MCP_TERMINAL_DISCONNECTED',
  /** Erro não classificado do servidor nativo (payload de erro JSON-RPC com código/mensagem próprios). */
  'MT5_MCP_TOOL_ERROR',
  /** Conta/terminal não permite trading agora (AutoTrading desligado, permissão da conta) — checado ANTES de qualquer envio de ordem. */
  'MT5_MCP_TRADING_NOT_ALLOWED',
] as const;

export type Mt5McpErrorCode = (typeof MT5_MCP_ERROR_CODES)[number];

export interface Mt5McpErrorPayload {
  readonly code: Mt5McpErrorCode;
  /** Mensagem já pronta para exibir ao usuário — nunca mensagem bruta de driver/rede/upstream. */
  readonly message: string;
}

/** Texto acionável por código — usado como fallback quando a rota não fornece `message` customizada. */
export const MT5_MCP_ERROR_MESSAGES: Record<Mt5McpErrorCode, string> = {
  MT5_MCP_NOT_CONFIGURED:
    'MCP nativo do MT5 não configurado no servidor (MT5_MCP_API_KEY ausente). Gere o token em MT5 > Tools > Options > MCP e configure o .env.',
  MT5_MCP_UNREACHABLE:
    'Não foi possível alcançar o MT5 MCP nativo. Verifique se o terminal está aberto e se "Ativar servidor interno" está ligado em Tools > Options > MCP.',
  MT5_MCP_SESSION_ERROR:
    'O MT5 MCP nativo aceitou a conexão mas não associou a sessão (limitação conhecida do build 6060). Tente novamente; se persistir, verifique a versão do terminal.',
  MT5_MCP_AUTH_FAILED:
    'Token do MT5 MCP nativo rejeitado. Gere um novo token em MT5 > Tools > Options > MCP e atualize o .env.',
  MT5_MCP_TOOL_MISSING:
    'Este recurso não está disponível na versão atual do MT5 MCP nativo instalada.',
  MT5_MCP_TERMINAL_DISCONNECTED:
    'O MT5 MCP nativo respondeu, mas nenhuma conta está logada no terminal. Faça login pela própria interface do MetaTrader 5.',
  MT5_MCP_TOOL_ERROR:
    'O MT5 MCP nativo retornou um erro ao processar a solicitação.',
  MT5_MCP_TRADING_NOT_ALLOWED:
    'Trading não permitido pelo terminal/conta MT5 no momento (verifique o botão AutoTrading e a permissão da conta).',
};
