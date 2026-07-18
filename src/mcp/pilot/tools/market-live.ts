/**
 * Tools de mercado que chamam os serviços Python Flask (spread_api.py na
 * porta 5000, volatility_api.py na porta 5555) via `HttpJson` injetado —
 * mesmo molde de `cvm-rich.ts`/`monitoring.ts`, mas sem Bearer (esses
 * serviços Flask não têm autenticação; `network_config` já restringe o
 * bind a loopback + CORS allowlist).
 */
import { z } from 'zod';
import { parseToolArgs, toToolError, type McpToolDefinition } from '../../tools/registry-types';
import type { HttpJson } from '../clients/http-json';

const SYMBOL_RE = /^[A-Za-z]{4}\d{0,2}$/;

export function buildMarketLiveTools(spread: HttpJson, volatility: HttpJson): readonly McpToolDefinition[] {
  return [
    {
      name: 'market.scan_options',
      description: 'Roda o scan de opções (covered call / cash-secured put) server-side para um ativo, mesma regra OTM da plataforma; persiste o scan no banco de opções.',
      privilege: 'free',
      inputSchema: {
        symbol: z.string().regex(SYMBOL_RE, 'símbolo B3 inválido (ex.: PETR4)').transform((s) => s.toUpperCase()),
        capital: z.number().positive().default(10_000),
        strikeRangePct: z.number().positive().default(10),
        minAnnualPct: z.number().default(5),
      },
      handler: async (args) => {
        try {
          const parsed = parseToolArgs(
            {
              symbol: z.string().regex(SYMBOL_RE, 'símbolo B3 inválido (ex.: PETR4)').transform((s) => s.toUpperCase()),
              capital: z.number().positive().default(10_000),
              strikeRangePct: z.number().positive().default(10),
              minAnnualPct: z.number().default(5),
            },
            args,
          );
          const body = {
            symbol: parsed.symbol,
            capital: parsed.capital,
            strike_range_pct: parsed.strikeRangePct,
            min_annual_pct: parsed.minAnnualPct,
          };
          return { content: [{ type: 'text', text: JSON.stringify(await spread.post('/api/options/scan', body)) }] };
        } catch (error) { return toToolError(error); }
      },
    },
    {
      name: 'market.find_spread_pairs',
      description: 'Busca os melhores pares para arbitragem de spread B3 (correlação, meia-vida de reversão, z-score).',
      privilege: 'free',
      inputSchema: { minCorrelation: z.number().min(-1).max(1).optional() },
      handler: async (args) => {
        try {
          const { minCorrelation } = parseToolArgs({ minCorrelation: z.number().min(-1).max(1).optional() }, args);
          const body = minCorrelation === undefined ? {} : { min_correlacao: minCorrelation };
          return { content: [{ type: 'text', text: JSON.stringify(await spread.post('/api/spread/find-best-pairs', body)) }] };
        } catch (error) { return toToolError(error); }
      },
    },
    {
      name: 'market.get_volatility',
      description: 'Obtém métricas de volatilidade (diária, anualizada, variação semanal) de um ativo.',
      privilege: 'free',
      inputSchema: { symbol: z.string().min(1).max(20) },
      handler: async (args) => {
        try {
          const { symbol } = parseToolArgs({ symbol: z.string().min(1).max(20) }, args);
          return { content: [{ type: 'text', text: JSON.stringify(await volatility.post('/api/volatility', { symbol })) }] };
        } catch (error) { return toToolError(error); }
      },
    },
  ];
}
