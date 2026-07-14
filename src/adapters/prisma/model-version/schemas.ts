import { z } from 'zod';
import { TimestampSchema } from '../feature-value/schemas';
import { isValidModelVersionSubmission } from '../../../domain/v1/models/model-version';

export { TimestampSchema };

export const ModelVersionKindSchema = z.enum(['ML', 'RULE']);

export const ModelVersionSubmissionSchema = z
  .object({
    kind: ModelVersionKindSchema,
    label: z.string().min(1).max(200),
    asOf: TimestampSchema,
    hyperparametersJson: z.string().min(1).max(20_000),
    trainingEvidenceJson: z.string().min(1).max(20_000).nullish(),
  })
  .strict()
  .superRefine((value, ctx) => {
    try {
      JSON.parse(value.hyperparametersJson);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'hyperparametersJson deve ser um JSON válido', path: ['hyperparametersJson'] });
    }
    if (!isValidModelVersionSubmission({ kind: value.kind, trainingEvidenceJson: value.trainingEvidenceJson })) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "kind='ML' exige trainingEvidenceJson válido (JSON de objeto não vazio) — corrige A20",
        path: ['trainingEvidenceJson'],
      });
    }
  });

export const ModelVersionInvalidationSchema = z
  .object({
    invalidatedAt: TimestampSchema,
    reason: z.string().min(1).max(2000),
  })
  .strict();

export type NormalizedModelVersionSubmission = z.infer<typeof ModelVersionSubmissionSchema>;
