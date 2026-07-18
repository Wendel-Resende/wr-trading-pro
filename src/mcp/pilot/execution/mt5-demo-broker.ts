/**
 * MCP Piloto — Task 7: broker de execução real (bridge MT5) para o trilho
 * de trade governado (`McpTradeService.approve`).
 *
 * `Mt5DemoBroker` implementa `PilotExecutionPort` sobre o `BridgeClient` da
 * Task 4 — chamado SÓ depois do gate completo (risco aprovado, código de
 * confirmação certo, kill switch ligado). O nome "Demo" é só documental:
 * o bloqueio real de conta é a guarda DEMO do lado Python
 * (`is_order_allowed_by_account` em `python/mt5_bridge.py`, Task 7) — este
 * broker não decide DEMO/real, apenas envia a ordem e traduz a resposta.
 *
 * Mapeamento de resposta: `handle_send_order` (Python) devolve
 * `{type: 'ORDER_RESULT', data: result._asdict()}` em sucesso, onde
 * `result` é o retorno de `mt5.order_send()` — um `TradeResult` do MT5 com
 * campos como `retcode`, `order` (ticket da ordem), `deal`, `volume`,
 * `price`, `sl`, `tp`, `comment`, `request_id`. O `BridgeClient.request`
 * já resolve a Promise só quando `retcode == 10009` (TRADE_RETCODE_DONE) —
 * qualquer outro caso (erro de conexão, rejeição do broker, order_check
 * falhou etc.) chega como `ERROR` do bridge, que o cliente já traduz para
 * `ReadModelError` (ver `bridgeErrorToReadModelError` em `../clients/mt5-bridge`).
 * Por isso o `ticket` mapeado aqui é sempre `data.order`, nunca `data.deal`.
 */
import type { PilotExecutionPort, PilotOrderRequest, PilotOrderResult } from '../../../domain/v1/ports/pilot-execution';
import type { BridgeClient } from '../clients/mt5-bridge';
import { ReadModelError } from '../../../application/read-models-v1/errors';

const DIRECTION_TO_MT5_TYPE: Record<PilotOrderRequest['direction'], string> = {
  BUY: 'ORDER_TYPE_BUY',
  SELL: 'ORDER_TYPE_SELL',
};

export class Mt5DemoBroker implements PilotExecutionPort {
  constructor(private readonly bridge: BridgeClient) {}

  async send(request: PilotOrderRequest): Promise<PilotOrderResult> {
    const body: Record<string, unknown> = {
      symbol: request.symbol,
      type: DIRECTION_TO_MT5_TYPE[request.direction],
      volume: request.volume,
      comment: request.comment,
    };
    if (request.stopLoss !== undefined) body.sl = request.stopLoss;
    if (request.takeProfit !== undefined) body.tp = request.takeProfit;

    try {
      const response = await this.bridge.request('SEND_ORDER', body);
      const ticket = typeof response.order === 'number' ? response.order : undefined;
      const price = typeof response.price === 'number' ? response.price : undefined;
      return { ok: true, ticket, price };
    } catch (error) {
      // NUNCA relançar: o `McpTradeService.approve` trata exceção do
      // broker como EXECUTION_FAILED, mas preferimos devolver `ok: false`
      // aqui sempre que a origem for um erro sanitizado conhecido — evita
      // vazar stack/credenciais e mantém a mensagem já traduzida pelo
      // `BridgeClient` (`bridgeErrorToReadModelError`), que nunca inclui
      // segredos (token, senha) — só código/mensagem do bridge.
      //
      // `error.message` aqui é seguro de expor porque `BridgeClient`
      // GARANTE que todo erro vindo do bridge (WS `type: 'ERROR'`, timeout,
      // falha de conexão) chega como `ReadModelError` já sanitizado — nunca
      // um erro cru do driver/protocolo. Se essa garantia mudar no
      // `BridgeClient`, esta suposição precisa ser revisitada.
      if (error instanceof ReadModelError) {
        return { ok: false, error: error.message };
      }
      const message = error instanceof Error ? error.message : 'erro desconhecido ao enviar ordem ao broker';
      return { ok: false, error: message };
    }
  }
}
