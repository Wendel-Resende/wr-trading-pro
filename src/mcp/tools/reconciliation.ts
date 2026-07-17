/**
 * `reconciliation.report`, `dataset.feature_values` (Fase 4, catálogo
 * seção 4.2). Read-only: `ReconciliationService.getReport` e
 * `FeatureValueService.getValues` nunca escrevem.
 */
import { z } from 'zod';
import type { McpReadServices } from '../ports/mcp-read-service';
import { parseToolArgs, toToolError, type McpToolDefinition } from './registry-types';

const reconciliationDomain = z.enum(['cvm-facts', 'market-bars', 'stock-monitoring']);

const reportShape = {
  decisionTime: z.string().min(1),
  knowledgeTime: z.string().min(1).optional(),
  domain: reconciliationDomain.optional(),
  from: z.string().min(1).optional(),
  to: z.string().min(1).optional(),
};

const featureValuesShape = {
  featureId: z.string().min(1).optional(),
  subjectId: z.string().min(1).optional(),
  decisionTime: z.string().min(1).optional(),
  knowledgeTime: z.string().min(1).optional(),
  from: z.string().min(1).optional(),
  to: z.string().min(1).optional(),
  limit: z.number().int().min(1).optional(),
  offset: z.number().int().min(0).optional(),
};

export function buildReconciliationTools(services: McpReadServices): readonly McpToolDefinition[] {
  return [
    {
      name: 'reconciliation.report',
      description: 'Relatório de reconciliação point-in-time (paridade/sem-paridade). Somente leitura.',
      inputSchema: reportShape,
      privilege: 'free',
      handler: async (args) => {
        try {
          const query = parseToolArgs(reportShape, args);
          const result = await services.reconciliation.getReport(query);
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        } catch (error) {
          return toToolError(error);
        }
      },
    },
    {
      name: 'dataset.feature_values',
      description: 'Valores de feature point-in-time, com proveniência. Somente leitura.',
      inputSchema: featureValuesShape,
      privilege: 'free',
      handler: async (args) => {
        try {
          const query = parseToolArgs(featureValuesShape, args);
          const result = await services.featureValue.getValues(query);
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        } catch (error) {
          return toToolError(error);
        }
      },
    },
  ];
}
