/**
 * `cvm.get_facts` / `b3.get_instrument` (Fase 4, catálogo seção 4.1).
 * Read-only: consomes `ReadModelV1Service.getFacts` / `.getInstrument`
 * via a facade `McpReadServices`. Nunca importa Prisma diretamente.
 */
import { z } from 'zod';
import type { McpReadServices } from '../ports/mcp-read-service';
import { parseToolArgs, toToolError, type McpToolDefinition } from './registry-types';

const cvmScope = z.enum(['CON', 'IND']);
const cvmStatementType = z.enum(['BPA', 'BPP', 'DRE', 'DFC_MI', 'DFC_MD', 'DVA', 'DMPL']);
const cvmDocumentType = z.enum(['DFP', 'ITR', 'FRE']);

const getFactsShape = {
  issuerId: z.string().min(1),
  documentType: cvmDocumentType,
  referenceDate: z.string().min(1),
  decisionTime: z.string().min(1),
  knowledgeTime: z.string().min(1),
  statementType: cvmStatementType.optional(),
  scope: cvmScope.optional(),
  accountCode: z.string().optional(),
  limit: z.number().int().min(1).default(100),
  offset: z.number().int().min(0).default(0),
};

const getInstrumentShape = {
  symbol: z.string().min(1),
  exchange: z.string().min(1),
  asOf: z.string().min(1),
  knowledgeTime: z.string().min(1),
};

export function buildCvmTools(services: McpReadServices): readonly McpToolDefinition[] {
  return [
    {
      name: 'cvm.get_facts',
      description: 'Fatos contábeis CVM point-in-time (as-of), com proveniência. Somente leitura.',
      inputSchema: getFactsShape,
      privilege: 'free',
      handler: async (args) => {
        try {
          const query = parseToolArgs(getFactsShape, args);
          const result = await services.readModel.getFacts(query);
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        } catch (error) {
          return toToolError(error);
        }
      },
    },
    {
      name: 'b3.get_instrument',
      description: 'Versão de instrumento (catálogo B3), visível em `asOf`/`knowledgeTime`. Somente leitura.',
      inputSchema: getInstrumentShape,
      privilege: 'free',
      handler: async (args) => {
        try {
          const query = parseToolArgs(getInstrumentShape, args);
          const result = await services.readModel.getInstrument(query);
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        } catch (error) {
          return toToolError(error);
        }
      },
    },
  ];
}
