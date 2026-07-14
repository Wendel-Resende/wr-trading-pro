import { z } from 'zod';
import { TimestampSchema } from '../feature-value/schemas';
import { isValidResearchWindow } from '../../../domain/v1/models/research-run';

export { TimestampSchema };

export const ResearchRunSubmissionSchema = z
  .object({
    name: z.string().min(1).max(200),
    hypothesis: z.string().min(1).max(5000),
    datasetId: z.string().min(1).max(200),
    windowStart: TimestampSchema,
    windowEnd: TimestampSchema,
    paramsJson: z.string().min(1).max(20_000),
    modelVersionId: z.string().min(1).max(64).nullish(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!isValidResearchWindow(value.windowStart, value.windowEnd)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'windowStart deve ser estritamente anterior a windowEnd', path: ['windowEnd'] });
    }
    try {
      JSON.parse(value.paramsJson);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'paramsJson deve ser um JSON válido', path: ['paramsJson'] });
    }
  });

export type NormalizedResearchRunSubmission = z.infer<typeof ResearchRunSubmissionSchema>;
