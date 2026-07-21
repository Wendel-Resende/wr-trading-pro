import { z } from 'zod';

/** `source` nunca pode ser "default" — custo B3 sem proveniência real não é aceito (D5). */
export const BacktestCostProfileSubmissionSchema = z
  .object({
    version: z.number().int().min(1),
    label: z.string().min(1).max(100),
    fixedBrokerage: z.number().finite().min(0),
    emolumentsPct: z.number().finite().min(0),
    spreadBps: z.number().finite().min(0),
    slippageBps: z.number().finite().min(0),
    lotSize: z.number().finite().gt(0),
    source: z
      .string()
      .min(1)
      .max(500)
      .refine((value) => value.trim().toLowerCase() !== 'default', {
        message: 'source não pode ser "default" — informe a proveniência real do custo (tarifário, documento, corretora)',
      }),
  })
  .strict();

export type NormalizedBacktestCostProfileSubmission = z.infer<typeof BacktestCostProfileSubmissionSchema>;
