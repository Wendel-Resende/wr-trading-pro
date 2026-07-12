/**
 * Marcador da futura borda de execução.
 *
 * Intencionalmente não possui método acionável no Item 1. O contrato de
 * execução só será aberto no Item 3, depois que OrderIntent carregar decisão
 * de risco, aprovação humana e chave de idempotência verificáveis.
 */
export interface ExecutionBroker {
  readonly capability: 'deferred-until-governed-order-intent';
}
