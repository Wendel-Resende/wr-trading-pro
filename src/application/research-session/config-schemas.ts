/**
 * Configuração por `kind`. Um rascunho de SIGNIFICANCE e um de MONTE_CARLO
 * não aceitam a mesma config — validar na criação evita uma sessão que só
 * descobre estar inválida na hora de rodar.
 *
 * Todo schema é `.strict()`: campo extra é rejeitado, nunca ignorado.
 */
import { z } from 'zod';

/**
 * Tetos de PRODUTO, não por dimensão. Os limites por campo sozinhos
 * permitiam 50.000 sinais x 20.000 simulações (~1e9 iterações) e 50.000
 * trades x 20.000 cenários (cada cenário recomputando `computeMetrics`
 * inteiro). O cálculo roda SÍNCRONO no MCP Pilot, que é processo filho do
 * Electron: uma configuração mal dimensionada do agente congelaria o app.
 *
 * Recusar na fronteira Zod é a única barreira barata — depois dela já não
 * há onde interromper. A mensagem diz o limite E o valor recebido, para o
 * agente conseguir se corrigir sozinho em vez de tentar de novo às cegas.
 */
export const MAX_SIGNIFICANCE_WORK = 5e7;
export const MAX_MONTE_CARLO_WORK = 5e6;

/** Defaults do núcleo — repetidos aqui porque o teto vale também quando o campo é omitido. */
const DEFAULT_N_SIMULATIONS = 2000;
const DEFAULT_N_SCENARIOS = 1000;

const TimestampSchema = z.string().datetime();

const BarSchema = z
  .object({
    time: TimestampSchema,
    open: z.number().finite(),
    high: z.number().finite(),
    low: z.number().finite(),
    close: z.number().finite(),
    knowledgeTime: TimestampSchema,
  })
  .strict();

const SignalSchema = z
  .object({
    barTime: TimestampSchema,
    direction: z.enum(['BUY', 'SELL', 'HOLD']),
    knowledgeTime: TimestampSchema,
    stopPrice: z.number().finite().nullish(),
    takeProfitPrice: z.number().finite().nullish(),
  })
  .strict();

export const SignificanceConfigSchema = z
  .object({
    bars: z.array(BarSchema).min(1).max(50_000),
    signals: z.array(SignalSchema).max(50_000),
    nSimulations: z.number().int().min(100).max(20_000).optional(),
    seed: z.number().int().optional(),
    meanBlockLength: z.number().int().min(1).max(500).optional(),
  })
  .strict()
  .superRefine((config, ctx) => {
    const nSignals = config.signals.length;
    const nSimulations = config.nSimulations ?? DEFAULT_N_SIMULATIONS;
    const work = nSignals * nSimulations;
    if (work > MAX_SIGNIFICANCE_WORK) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['nSimulations'],
        message:
          `custo excessivo: signals (${nSignals}) x nSimulations (${nSimulations}) = ${work}, ` +
          `acima do teto de ${MAX_SIGNIFICANCE_WORK}. Reduza a amostra de sinais ou o número de simulações.`,
      });
    }
  });

const TradeSchema = z
  .object({
    signalBarTime: TimestampSchema,
    entryTime: TimestampSchema,
    entryPrice: z.number().finite(),
    exitTime: TimestampSchema,
    exitPrice: z.number().finite(),
    direction: z.enum(['BUY', 'SELL']),
    grossPnl: z.number().finite(),
    costs: z.number().finite(),
    netPnl: z.number().finite(),
    netReturn: z.number().finite(),
    exitReason: z.enum(['STOP', 'TAKE_PROFIT', 'WINDOW_END', 'HORIZON_END']),
  })
  .strict();

export const MonteCarloConfigSchema = z
  .object({
    trades: z.array(TradeSchema).max(50_000),
    periodsPerYear: z.number().positive().max(525_600),
    startingBalance: z.number().positive(),
    nScenarios: z.number().int().min(10).max(20_000).optional(),
    seed: z.number().int().optional(),
  })
  .strict()
  .superRefine((config, ctx) => {
    const nTrades = config.trades.length;
    const nScenarios = config.nScenarios ?? DEFAULT_N_SCENARIOS;
    const work = nTrades * nScenarios;
    if (work > MAX_MONTE_CARLO_WORK) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['nScenarios'],
        message:
          `custo excessivo: trades (${nTrades}) x nScenarios (${nScenarios}) = ${work}, ` +
          `acima do teto de ${MAX_MONTE_CARLO_WORK}. Reduza o conjunto de trades ou o número de cenários.`,
      });
    }
  });

export type SignificanceConfig = z.infer<typeof SignificanceConfigSchema>;
export type MonteCarloConfig = z.infer<typeof MonteCarloConfigSchema>;
