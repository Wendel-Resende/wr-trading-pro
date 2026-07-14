import { z } from 'zod';
import { parseInstant } from '../../../domain/v1/time';
import { hasAtMostMillisecondPrecision } from '../agent-run/timestamps';

export const TimestampSchema = z
  .string()
  .min(1)
  .max(40)
  .refine((value) => parseInstant(value) !== null, 'timestamp ISO-8601 inválido: exige offset explícito e calendário real')
  .refine(
    hasAtMostMillisecondPrecision,
    'timestamp não pode ter mais de 3 dígitos de fração: precisão máxima persistida é milissegundo',
  );

export const SpreadOrderAuditActionSchema = z.enum(['CREATE', 'CANCEL']);

export const CreateSpreadOrderAuditBodySchema = z
  .object({
    orderId: z.string().min(1).max(64),
    action: SpreadOrderAuditActionSchema,
    payload: z.unknown(),
    decisionTime: TimestampSchema,
  })
  .strict();

export type NormalizedCreateSpreadOrderAuditBody = z.infer<typeof CreateSpreadOrderAuditBodySchema>;
