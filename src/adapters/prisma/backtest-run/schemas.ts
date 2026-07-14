import { z } from 'zod';
import { TimestampSchema } from '../feature-value/schemas';
import { compareInstants, parseInstant } from '../../../domain/v1/time';

export { TimestampSchema };

export const EntryRuleSchema = z.literal('open_next_bar');

export const BacktestCostsSchema = z
  .object({
    fixedBrokerage: z.number().finite().min(0),
    emolumentsPct: z.number().finite().min(0),
    spreadBps: z.number().finite().min(0),
    slippageBps: z.number().finite().min(0),
    lotSize: z.number().finite().gt(0),
  })
  .strict();

export const BacktestRunSubmissionSchema = z
  .object({
    researchRunId: z.string().min(1).max(64),
    modelVersionId: z.string().min(1).max(64),
    instrumentId: z.string().min(1).max(200),
    entryRule: EntryRuleSchema,
    costs: BacktestCostsSchema,
    windowStart: TimestampSchema,
    windowEnd: TimestampSchema,
    embargoDays: z.number().int().min(0).max(3650),
  })
  .strict()
  .refine(
    (value) => compareInstants(parseInstant(value.windowStart)!, parseInstant(value.windowEnd)!) < 0,
    { message: 'windowStart deve ser estritamente anterior a windowEnd', path: ['windowEnd'] },
  );

export type NormalizedBacktestRunSubmission = z.infer<typeof BacktestRunSubmissionSchema>;
