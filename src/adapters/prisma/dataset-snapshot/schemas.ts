import { z } from 'zod';
import { compareInstants, parseInstant } from '../../../domain/v1/time';
import { normalizeSnapshotId } from './normalize';
import { hasAtMostMillisecondPrecision } from './timestamps';

/**
 * Zod strict validation at the dataset-snapshot adapter boundary. Every
 * value entering the seeding helper or leaving the read repository as a
 * query argument passes through here first.
 */

export const TimestampSchema = z
  .string()
  .min(1)
  .max(40)
  .refine((value) => parseInstant(value) !== null, 'timestamp ISO-8601 inválido: exige offset explícito e calendário real')
  .refine(
    hasAtMostMillisecondPrecision,
    'timestamp não pode ter mais de 3 dígitos de fração: precisão máxima persistida é milissegundo',
  );

export const IngestionRunIdSchema = z.string().min(1).max(64);

export const SnapshotIdSchema = z.string().min(1).max(200).transform(normalizeSnapshotId);

const NonNegativeIntSchema = z.number().int().min(0);

export const DatasetSnapshotDomainsSchema = z
  .object({
    referenceData: z
      .object({
        issuers: NonNegativeIntSchema,
        instrumentVersions: NonNegativeIntSchema,
      })
      .strict(),
    cvm: z
      .object({
        filings: NonNegativeIntSchema,
        facts: NonNegativeIntSchema,
        shareCapitalFacts: NonNegativeIntSchema,
      })
      .strict(),
    marketBars: z
      .object({
        count: NonNegativeIntSchema,
      })
      .strict(),
  })
  .strict();

export const DatasetSnapshotSubmissionSchema = z
  .object({
    snapshotId: SnapshotIdSchema,
    asOf: TimestampSchema,
    knowledgeTime: TimestampSchema,
    decisionTime: TimestampSchema,
    domains: DatasetSnapshotDomainsSchema,
  })
  .strict()
  .refine((value) => compareInstants(parseInstant(value.knowledgeTime)!, parseInstant(value.decisionTime)!) <= 0, {
    message: 'knowledgeTime não pode ser posterior a decisionTime',
    path: ['knowledgeTime'],
  });

export const DatasetSnapshotQuerySchema = z
  .object({
    decisionTime: TimestampSchema,
    knowledgeTime: TimestampSchema.optional(),
    from: TimestampSchema.optional(),
    to: TimestampSchema.optional(),
    limit: z.number().int().min(1).max(5000).optional(),
    offset: z.number().int().min(0).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.knowledgeTime === undefined
      || compareInstants(parseInstant(value.knowledgeTime)!, parseInstant(value.decisionTime)!) <= 0,
    { message: 'knowledgeTime não pode ser posterior a decisionTime', path: ['knowledgeTime'] },
  );

export type NormalizedDatasetSnapshotSubmission = z.infer<typeof DatasetSnapshotSubmissionSchema>;
export type NormalizedDatasetSnapshotQuery = z.infer<typeof DatasetSnapshotQuerySchema>;
