/**
 * MCP Piloto — Task 6: porta de execução do trilho de trade governado.
 * Implementação real (bridge MT5) chega na Task 7; aqui só a interface,
 * usada pelo `McpTradeService` e por um broker fake nos testes.
 */
export interface PilotOrderRequest {
  readonly symbol: string;
  readonly direction: 'BUY' | 'SELL';
  readonly volume: number;
  readonly stopLoss?: number;
  readonly takeProfit?: number;
  readonly comment: string; // `mcp:<proposalId>`
}

export interface PilotOrderResult {
  readonly ok: boolean;
  readonly ticket?: number;
  readonly price?: number;
  readonly error?: string;
}

export interface PilotExecutionPort {
  send(request: PilotOrderRequest): Promise<PilotOrderResult>;
}
