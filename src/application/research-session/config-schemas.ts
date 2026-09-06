/**
 * Configuração por `kind`. Um rascunho de SIGNIFICANCE e um de MONTE_CARLO
 * não aceitam a mesma config — validar na criação evita uma sessão que só
 * descobre estar inválida na hora de rodar.
 *
 * Todo schema é `.strict()`: campo extra é rejeitado, nunca ignorado.
 */
import { z } from 'zod';

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
  .strict();

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
  .strict();

export type SignificanceConfig = z.infer<typeof SignificanceConfigSchema>;
export type MonteCarloConfig = z.infer<typeof MonteCarloConfigSchema>;
