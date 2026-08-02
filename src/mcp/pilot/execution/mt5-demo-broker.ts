/**
 * MCP Piloto — Task 7 → Legacy-D Gate D3: broker de execução FAIL-CLOSED
 * para o trilho de trade governado (`McpTradeService.approve`).
 *
 * Envio real de ordem via bridge Python (`SEND_ORDER`/`handle_send_order`)
 * nunca migra ao MCP nativo — e não deve. `Mt5DemoBroker.send()` nunca
 * chama o bridge, nunca monta corpo de ordem, nunca retorna `ok: true`:
 * sempre falha com o mesmo contrato `MT5_TRADING_UNAVAILABLE` já usado no
 * app principal.
 *
 * `Mt5TradingUnavailableError` abaixo é uma CÓPIA deliberada (não import)
 * de `src/services/mt5Service.ts:37-47` — mesmo CODE/MESSAGE literais.
 * Gate D3-FIX: importar `mt5Service.ts` puxa `@/lib/redact`/`@/types/mt5`
 * (alias de path), que `tsc` não reescreve para caminho relativo ao
 * compilar; `node` puro (pipeline de `scripts/mcp-pilot/run-mcp-pilot-tests.cjs`,
 * sem `tsc-alias`) falha com `MODULE_NOT_FOUND` em runtime. Duplicar aqui
 * evita essa dependência transitiva. Se o texto de MESSAGE em
 * `mt5Service.ts` mudar, esta cópia precisa ser atualizada manualmente.
 */
import type { PilotExecutionPort, PilotOrderRequest, PilotOrderResult } from '../../../domain/v1/ports/pilot-execution';

export class Mt5TradingUnavailableError extends Error {
  static readonly CODE = 'MT5_TRADING_UNAVAILABLE' as const;
  static readonly MESSAGE =
    'Envio, alteração e fechamento de ordens não estão disponíveis nesta versão. Nenhuma ordem foi enviada ao MT5.';
  readonly code = Mt5TradingUnavailableError.CODE;

  constructor() {
    super(Mt5TradingUnavailableError.MESSAGE);
    this.name = 'Mt5TradingUnavailableError';
  }
}

export class Mt5DemoBroker implements PilotExecutionPort {
  async send(request: PilotOrderRequest): Promise<PilotOrderResult> {
    void request;
    return { ok: false, error: Mt5TradingUnavailableError.MESSAGE };
  }
}
