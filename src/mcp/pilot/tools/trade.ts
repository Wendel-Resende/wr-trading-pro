/**
 * MCP Piloto — Task 7: tools `trade.*` do trilho de trade governado —
 * as ÚNICAS 4 tools `privilege: 'gated'` do catálogo (todo o resto é
 * `'free'`, ver `../../tools/registry-types`). Fina camada de tradução
 * Zod -> `McpTradeService` (Task 6); nenhuma regra de negócio aqui.
 *
 * SEGURANÇA (achado de review da Task 6): `requestedBy` NÃO é argumento
 * da tool `trade.propose` — é fixado aqui como `'mcp:hermes'`,
 * independente do que o chamador envie. Se `requestedBy` viesse do
 * argumento, um agente poderia variar esse valor a cada chamada para
 * burlar o rate limit por `requestedBy` do `McpTradeService.propose`
 * (`countRecentByRequester`) — cada "identidade" nova reabriria a cota.
 * Fixar o valor no servidor fecha esse desvio.
 */
import { z } from 'zod';
import { parseToolArgs, toToolError, type McpToolDefinition } from '../../tools/registry-types';
import type { McpTradeService } from '../../../application/mcp-trade/service';

const MCP_REQUESTED_BY = 'mcp:hermes';

const PROPOSE_SHAPE = {
  symbol: z.string().regex(/^[A-Za-z]{4}\d{1,2}$/, 'símbolo B3 inválido (ex.: PETR4)'),
  direction: z.enum(['BUY', 'SELL']),
  volume: z.number().positive().max(10_000),
  stopLoss: z.number().positive().optional(),
  takeProfit: z.number().positive().optional(),
  rationale: z.string().min(10).max(2000),
};

const APPROVE_SHAPE = {
  proposalId: z.string().uuid(),
  confirmationCode: z.string().regex(/^\d{6}$/, 'código de confirmação deve ter 6 dígitos'),
};

const PROPOSAL_ID_SHAPE = {
  proposalId: z.string().uuid(),
};

export function buildTradeTools(service: McpTradeService): readonly McpToolDefinition[] {
  return [
    {
      name: 'trade.propose',
      description: 'Propõe uma ordem de compra/venda B3 para o trilho governado de trade — passa por avaliação de risco e exige aprovação humana com código de confirmação antes de qualquer envio ao broker.',
      privilege: 'gated',
      inputSchema: PROPOSE_SHAPE,
      handler: async (args) => {
        try {
          const parsed = parseToolArgs(PROPOSE_SHAPE, args);
          const result = await service.propose({
            // `requestedBy` NUNCA vem de `args` — ver docblock do módulo.
            requestedBy: MCP_REQUESTED_BY,
            symbol: parsed.symbol.toUpperCase(),
            direction: parsed.direction,
            volume: parsed.volume,
            stopLoss: parsed.stopLoss,
            takeProfit: parsed.takeProfit,
            rationale: parsed.rationale,
          });
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        } catch (error) { return toToolError(error); }
      },
    },
    {
      name: 'trade.approve',
      description: 'Aprova uma proposta de trade pendente com o código de confirmação de 6 dígitos, disparando a criação da order intent e (se o kill switch estiver ligado) o envio ao broker.',
      privilege: 'gated',
      inputSchema: APPROVE_SHAPE,
      handler: async (args) => {
        try {
          const parsed = parseToolArgs(APPROVE_SHAPE, args);
          const result = await service.approve(parsed);
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        } catch (error) { return toToolError(error); }
      },
    },
    {
      name: 'trade.reject',
      description: 'Rejeita uma proposta de trade pendente de aprovação humana, encerrando-a sem enviar nada ao broker.',
      privilege: 'gated',
      inputSchema: PROPOSAL_ID_SHAPE,
      handler: async (args) => {
        try {
          const parsed = parseToolArgs(PROPOSAL_ID_SHAPE, args);
          const result = await service.reject(parsed.proposalId);
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        } catch (error) { return toToolError(error); }
      },
    },
    {
      name: 'trade.status',
      description: 'Consulta o estado atual de uma proposta de trade (status, decisão de risco, order intents associadas).',
      privilege: 'gated',
      inputSchema: PROPOSAL_ID_SHAPE,
      handler: async (args) => {
        try {
          const parsed = parseToolArgs(PROPOSAL_ID_SHAPE, args);
          const result = await service.status(parsed.proposalId);
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        } catch (error) { return toToolError(error); }
      },
    },
  ];
}
