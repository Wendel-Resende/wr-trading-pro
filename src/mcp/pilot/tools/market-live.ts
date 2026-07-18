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
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Schema compartilhado de `market.scan_options` — evita duplicar o shape entre
// `inputSchema` (usado para introspecção MCP) e o parse feito no handler.
const SCAN_OPTIONS_SCHEMA = {
  symbol: z.string().regex(SYMBOL_RE, 'símbolo B3 inválido (ex.: PETR4)').transform((s) => s.toUpperCase()),
  capital: z.number().positive().default(10_000),
  strikeRangePct: z.number().positive().default(10),
  minAnnualPct: z.number().default(5),
};

// Formata uma Date em `YYYY-MM-DD` (UTC) para os campos `data_inicial`/`data_final`
// que a rota Flask `find_best_pairs` espera via `datetime.fromisoformat`.
function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function buildMarketLiveTools(spread: HttpJson, volatility: HttpJson): readonly McpToolDefinition[] {
  return [
    {
      name: 'market.scan_options',
      description: 'Roda o scan de opções (covered call / cash-secured put) server-side para um ativo, mesma regra OTM da plataforma; persiste o scan no banco de opções.',
      privilege: 'free',
      inputSchema: SCAN_OPTIONS_SCHEMA,
      handler: async (args) => {
        try {
          const parsed = parseToolArgs(SCAN_OPTIONS_SCHEMA, args);
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
      inputSchema: {
        minCorrelation: z.number().min(-1).max(1).optional(),
        startDate: z.string().regex(DATE_RE, 'data inválida (formato YYYY-MM-DD)').optional(),
        endDate: z.string().regex(DATE_RE, 'data inválida (formato YYYY-MM-DD)').optional(),
      },
      handler: async (args) => {
        try {
          const { minCorrelation, startDate, endDate } = parseToolArgs(
            {
              minCorrelation: z.number().min(-1).max(1).optional(),
              startDate: z.string().regex(DATE_RE, 'data inválida (formato YYYY-MM-DD)').optional(),
              endDate: z.string().regex(DATE_RE, 'data inválida (formato YYYY-MM-DD)').optional(),
            },
            args,
          );
          // A rota Flask `find_best_pairs` indexa `data['data_inicial']`/`data['data_final']`
          // sem default — precisamos sempre enviar os dois. Default: últimos 365 dias.
          const now = new Date();
          const oneYearAgo = new Date(now);
          oneYearAgo.setUTCDate(oneYearAgo.getUTCDate() - 365);
          const body: Record<string, unknown> = {
            data_inicial: startDate ?? toIsoDate(oneYearAgo),
            data_final: endDate ?? toIsoDate(now),
          };
          if (minCorrelation !== undefined) body.min_correlacao = minCorrelation;
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
