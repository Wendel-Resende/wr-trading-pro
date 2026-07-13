import { z } from 'zod';
import { compareInstants, parseInstant } from '../../../domain/v1/time';

/**
 * Zod validation at the reconciliation adapter boundary. Mirrors the
 * conventions of the other Fase 2 adapters (market-bar, dataset-snapshot):
 * strict timestamp parsing with at-most-millisecond precision (SQLite
 * DateTime resolution), explicit domain enum, no free-form query keys.
 */

const FRACTION_PATTERN = /\.(\d+)/;
const MAX_FRACTION_DIGITS = 3;

export const hasAtMostMillisecondPrecision = (value: string): boolean => {
  const match = FRACTION_PATTERN.exec(value);
  return !match || match[1].length <= MAX_FRACTION_DIGITS;
};

export const TimestampSchema = z
  .string()
  .min(1)
  .max(40)
  .refine((value) => parseInstant(value) !== null, 'timestamp ISO-8601 inválido: exige offset explícito e calendário real')
  .refine(
    hasAtMostMillisecondPrecision,
    'timestamp não pode ter mais de 3 dígitos de fração: precisão máxima persistida é milissegundo',
  );

export const ReconciliationDomainSchema = z.enum(['cvm-facts', 'market-bars', 'stock-monitoring']);

export const SubjectIdSchema = z.string().min(1).max(200);

export const ReconciliationRowQuerySchema = z
  .object({
    decisionTime: TimestampSchema,
    knowledgeTime: TimestampSchema,
    domain: ReconciliationDomainSchema.optional(),
    subjectId: SubjectIdSchema.optional(),
    from: TimestampSchema.optional(),
    to: TimestampSchema.optional(),
    limit: z.number().int().min(1).max(1000).optional(),
    offset: z.number().int().min(0).optional(),
  })
  .strict()
  .refine(
    (value) => compareInstants(parseInstant(value.knowledgeTime)!, parseInstant(value.decisionTime)!) <= 0,
    { message: 'knowledgeTime não pode ser posterior a decisionTime', path: ['knowledgeTime'] },
  );

export type NormalizedReconciliationRowQuery = z.infer<typeof ReconciliationRowQuerySchema>;
