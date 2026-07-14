/**
 * `market.get_bars` (Fase 4, catálogo seção 4.1). Read-only, sem
 * lookahead — `ReadModelV1Service.getMarketBars` já garante
 * `knowledgeTime <= decisionTime` e nunca retorna candle com
 * `time > knowledgeTime` (CR-9).
 *
 * `portfolio.snapshot` do catálogo NÃO é implementada nesta fase: não
 * existe application service de leitura para `PortfolioProvider` — a
 * única implementação é o adapter MT5 (`src/adapters/mt5/portfolio-provider.ts`),
 * uma fonte ao vivo, não um read-model Prisma versionado. A regra 6 da
 * spec ("crie a tool apenas se o service de leitura existir") impede
 * inventar uma consulta Prisma fora dos adapters existentes só para
 * preencher o catálogo. Desvio reportado ao Guardião.
 */
import { z } from 'zod';
import type { McpReadServices } from '../ports/mcp-read-service';
import { parseToolArgs, toToolError, type McpToolDefinition } from './registry-types';

const timeframe = z.enum(['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w']);

const getBarsShape = {
  instrumentVersionId: z.string().min(1),
  sourceKey: z.string().min(1),
  timeframe,
  from: z.string().min(1),
  to: z.string().min(1),
  decisionTime: z.string().min(1),
  knowledgeTime: z.string().min(1),
  limit: z.number().int().min(1).default(500),
};

export function buildMarketTools(services: McpReadServices): readonly McpToolDefinition[] {
  return [
    {
      name: 'market.get_bars',
      description: 'Candles versionados (read-model), sem lookahead (time <= knowledgeTime). Somente leitura.',
      inputSchema: getBarsShape,
      handler: async (args) => {
        try {
          const query = parseToolArgs(getBarsShape, args);
          const result = await services.readModel.getMarketBars(query);
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        } catch (error) {
          return toToolError(error);
        }
      },
    },
  ];
}
