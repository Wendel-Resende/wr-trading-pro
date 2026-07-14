import { z } from 'zod';
import { TimestampSchema } from '../feature-value/schemas';
import { isPointInTimeSignal } from '../../../domain/v1/models/signal';

export { TimestampSchema };

export const SignalDirectionSchema = z.enum(['BUY', 'SELL', 'HOLD']);

export const SignalSubmissionSchema = z
  .object({
    modelVersionId: z.string().min(1).max(64),
    instrumentId: z.string().min(1).max(200),
    barTime: TimestampSchema,
    direction: SignalDirectionSchema,
    score: z.number().finite().nullish(),
    knowledgeTime: TimestampSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!isPointInTimeSignal(value.barTime, value.knowledgeTime)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'knowledgeTime não pode ser posterior a barTime (point-in-time obrigatório)',
        path: ['knowledgeTime'],
      });
    }
  });

export type NormalizedSignalSubmission = z.infer<typeof SignalSubmissionSchema>;
