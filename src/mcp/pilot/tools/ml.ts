/**
 * Tools de ML — buscam candles ao vivo do MT5 via `BridgeClient`
 * (`GET_CHART_DATA`) e rodam os modelos EM PROCESSO (não delegam a uma
 * rota Next), reaproveitando `runMACrossover`/`runLinearRegression`
 * (`../../../services/mlModels`) e `runBacktest`
 * (`../../../services/backtesting`) — mesmos motores usados pela UI.
 *
 * Mapeamento de campos: `GET_CHART_DATA` (ver `handle_get_chart_data` em
 * `python/mt5_bridge.py`) devolve candles com `time` (epoch em segundos,
 * não `Date`), `open`, `high`, `low`, `close`, `volume` — o `Candle` de
 * `historicalDataService.ts` espera `time: Date`, por isso convertemos
 * `time * 1000` antes de repassar aos modelos.
 *
 * Mínimo de candles: `slowPeriod + 10` cobre o MA Crossover; a
 * regressão linear usa `lookback` fixo (default 50, sem parâmetro
 * exposto nesta tool) — por isso o mínimo real é
 * `max(slowPeriod + 10, LR_LOOKBACK_DEFAULT + 10)`, garantindo dados
 * suficientes para os dois modelos com os parâmetros default.
 */
import { z } from 'zod';
import { parseToolArgs, toToolError, type McpToolDefinition } from '../../tools/registry-types';
import type { BridgeClient } from '../clients/mt5-bridge';
import type { Candle } from '../../../services/historicalDataService';
import { runMACrossover, runLinearRegression, type ModelPrediction } from '../../../services/mlModels';
import { runBacktest, type BacktestParams } from '../../../services/backtesting';
import { ReadModelError } from '../../../application/read-models-v1/errors';

const LR_LOOKBACK_DEFAULT = 50;

const TIMEFRAME = z.enum(['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1']);
const MODEL = z.enum(['ma_crossover', 'linear_regression']);

const BASE_SHAPE = {
  symbol: z.string().min(1).max(20),
  timeframe: TIMEFRAME,
  model: MODEL,
  fastPeriod: z.number().int().positive().default(10),
  slowPeriod: z.number().int().positive().default(30),
  count: z.number().int().min(1).max(5000).default(200),
};

interface RawCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Converte candles crus do bridge (`GET_CHART_DATA`) para o `Candle[]` esperado pelos modelos. */
function toCandles(raw: unknown): Candle[] {
  const list = Array.isArray(raw) ? raw : [];
  return (list as RawCandle[]).map((c) => ({
    time: new Date(c.time * 1000),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }));
}

async function fetchCandles(bridge: BridgeClient, symbol: string, timeframe: string, count: number): Promise<Candle[]> {
  const response = await bridge.request('GET_CHART_DATA', { symbol, timeframe, count });
  return toCandles((response as { candles?: unknown }).candles);
}

function minCandlesNeeded(slowPeriod: number): number {
  return Math.max(slowPeriod + 10, LR_LOOKBACK_DEFAULT + 10);
}

function assertEnoughCandles(candles: Candle[], slowPeriod: number): void {
  const needed = minCandlesNeeded(slowPeriod);
  if (candles.length < needed) {
    throw new ReadModelError('INSUFFICIENT_DATA', `candles insuficientes: obtidos ${candles.length}, necessários ${needed}`);
  }
}

function runModel(model: 'ma_crossover' | 'linear_regression', candles: Candle[], fastPeriod: number, slowPeriod: number): ModelPrediction {
  return model === 'ma_crossover'
    ? runMACrossover(candles, { fastPeriod, slowPeriod })
    : runLinearRegression(candles);
}

export function buildMlTools(bridge: BridgeClient): readonly McpToolDefinition[] {
  return [
    {
      name: 'ml.run_prediction',
      description: 'Roda um modelo de ML (MA Crossover ou Regressão Linear) em process sobre candles ao vivo do MT5, retornando sinal e confiança.',
      privilege: 'free',
      inputSchema: BASE_SHAPE,
      handler: async (args) => {
        try {
          const parsed = parseToolArgs(BASE_SHAPE, args);
          const candles = await fetchCandles(bridge, parsed.symbol, parsed.timeframe, parsed.count);
          assertEnoughCandles(candles, parsed.slowPeriod);
          const prediction = runModel(parsed.model, candles, parsed.fastPeriod, parsed.slowPeriod);
          return { content: [{ type: 'text', text: JSON.stringify(prediction) }] };
        } catch (error) { return toToolError(error); }
      },
    },
    {
      name: 'ml.run_backtest',
      description: 'Roda backtest em process (MA Crossover ou Regressão Linear) sobre candles ao vivo do MT5.',
      privilege: 'free',
      inputSchema: { ...BASE_SHAPE, backtestParams: z.record(z.union([z.number(), z.string()])).optional() },
      handler: async (args) => {
        try {
          const parsed = parseToolArgs({ ...BASE_SHAPE, backtestParams: z.record(z.union([z.number(), z.string()])).optional() }, args);
          const candles = await fetchCandles(bridge, parsed.symbol, parsed.timeframe, parsed.count);
          assertEnoughCandles(candles, parsed.slowPeriod);
          const modelParams = parsed.model === 'ma_crossover' ? { fastPeriod: parsed.fastPeriod, slowPeriod: parsed.slowPeriod } : {};
          const modelFn = (c: Candle[], p?: Record<string, unknown>) => runModel(parsed.model, c, (p?.fastPeriod as number) ?? parsed.fastPeriod, (p?.slowPeriod as number) ?? parsed.slowPeriod);
          const result = runBacktest(candles, modelFn, modelParams, (parsed.backtestParams ?? {}) as Partial<BacktestParams>);
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        } catch (error) { return toToolError(error); }
      },
    },
  ];
}
