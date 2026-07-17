/**
 * Tools proxy de monitoramento/alertas/relatórios — mesmo molde de
 * `cvm-rich.ts`: repassam para as rotas Next já existentes via `HttpJson`
 * injetado (Bearer `WR_SERVICE_TOKEN`), sem tocar Prisma diretamente.
 */
import { z } from 'zod';
import { parseToolArgs, toToolError, type McpToolDefinition } from '../../tools/registry-types';
import type { HttpJson } from '../clients/http-json';

export function buildMonitoringTools(next: HttpJson): readonly McpToolDefinition[] {
  return [
    {
      name: 'monitoring.list',
      description: 'Lista todas as posições monitoradas (stock-monitoring).',
      privilege: 'free',
      inputSchema: {},
      handler: async () => {
        try { return { content: [{ type: 'text', text: JSON.stringify(await next.get('/api/stock-monitoring')) }] }; }
        catch (error) { return toToolError(error); }
      },
    },
    {
      name: 'monitoring.add',
      description: 'Adiciona uma posição ao monitoramento (símbolo, quantidade e preço médio opcionais).',
      privilege: 'free',
      inputSchema: { symbol: z.string().min(1).max(20), quantity: z.number().optional(), avgPrice: z.number().optional() },
      handler: async (args) => {
        try {
          const body = parseToolArgs({ symbol: z.string().min(1).max(20), quantity: z.number().optional(), avgPrice: z.number().optional() }, args);
          return { content: [{ type: 'text', text: JSON.stringify(await next.post('/api/stock-monitoring', body)) }] };
        } catch (error) { return toToolError(error); }
      },
    },
    {
      name: 'monitoring.remove',
      description: 'Remove uma posição monitorada pelo id.',
      privilege: 'free',
      inputSchema: { id: z.string().min(1) },
      handler: async (args) => {
        try {
          const { id } = parseToolArgs({ id: z.string().min(1) }, args);
          return { content: [{ type: 'text', text: JSON.stringify(await next.del(`/api/stock-monitoring/${encodeURIComponent(id)}`)) }] };
        } catch (error) { return toToolError(error); }
      },
    },
    {
      name: 'alerts.list',
      description: 'Lista os alertas de monitoramento (preço, dividendo, status, carteira).',
      privilege: 'free',
      inputSchema: {},
      handler: async () => {
        try { return { content: [{ type: 'text', text: JSON.stringify(await next.get('/api/stock-alerts')) }] }; }
        catch (error) { return toToolError(error); }
      },
    },
    {
      name: 'alerts.create',
      description: 'Cria um alerta (símbolo, condição e preço-alvo).',
      privilege: 'free',
      inputSchema: { symbol: z.string().min(1).max(20), condition: z.string().min(1), price: z.number() },
      handler: async (args) => {
        try {
          const body = parseToolArgs({ symbol: z.string().min(1).max(20), condition: z.string().min(1), price: z.number() }, args);
          return { content: [{ type: 'text', text: JSON.stringify(await next.post('/api/stock-alerts', body)) }] };
        } catch (error) { return toToolError(error); }
      },
    },
    {
      name: 'reports.get',
      description: 'Obtém os relatórios de ações monitoradas.',
      privilege: 'free',
      inputSchema: {},
      handler: async () => {
        try { return { content: [{ type: 'text', text: JSON.stringify(await next.get('/api/stock-reports')) }] }; }
        catch (error) { return toToolError(error); }
      },
    },
  ];
}
