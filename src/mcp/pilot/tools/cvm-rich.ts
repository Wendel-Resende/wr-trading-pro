// src/mcp/pilot/tools/cvm-rich.ts
import { z } from 'zod';
import { parseToolArgs, toToolError, type McpToolDefinition } from '../../tools/registry-types';
import type { HttpJson } from '../clients/http-json';

export function buildCvmRichTools(next: HttpJson): readonly McpToolDefinition[] {
  return [
    {
      name: 'cvm.list_companies',
      description: 'Lista as 138 empresas do banco CVM (ticker, nome, setor, proveniência).',
      privilege: 'free',
      inputSchema: {},
      handler: async () => {
        try { return { content: [{ type: 'text', text: JSON.stringify(await next.get('/api/cvm/companies')) }] }; }
        catch (error) { return toToolError(error); }
      },
    },
    {
      name: 'cvm.company_fundamentals',
      description: 'Fundamentos trimestrais completos de uma empresa (cd_cvm) — DRE, margens, ROE, dividendos.',
      privilege: 'free',
      inputSchema: { cdCvm: z.string().min(1).max(10) },
      handler: async (args) => {
        try {
          const { cdCvm } = parseToolArgs({ cdCvm: z.string().min(1).max(10) }, args);
          return { content: [{ type: 'text', text: JSON.stringify(await next.get(`/api/cvm/companies/${encodeURIComponent(cdCvm)}`)) }] };
        } catch (error) { return toToolError(error); }
      },
    },
    {
      name: 'cvm.dividends_portfolio',
      description: 'Score de qualidade de dividendos e carteira 12 vigente (gates Monte Carlo).',
      privilege: 'free',
      inputSchema: {},
      handler: async () => {
        try { return { content: [{ type: 'text', text: JSON.stringify(await next.get('/api/cvm/dividends')) }] }; }
        catch (error) { return toToolError(error); }
      },
    },
  ];
}
