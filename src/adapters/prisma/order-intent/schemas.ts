import { z } from 'zod';
import { parseInstant } from '../../../domain/v1/time';
import { hasAtMostMillisecondPrecision } from '../agent-run/timestamps';

/**
 * Zod strict validation at the order-intent adapter boundary. Every
 * value entering the repository/API (submission, creation request)
 * passes through here first; nothing free-form crosses into Prisma.
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

export const OrderIntentDirectionSchema = z.enum(['BUY', 'SELL']);

export const OrderIntentStatusSchema = z.enum(['CREATED', 'CANCELLED']);

export const CreateOrderIntentBodySchema = z
  .object({
    decisionId: z.string().min(1).max(200),
    idempotencyKey: z.string().min(1).max(200),
    quantity: z.number().int().min(1),
    decisionTime: TimestampSchema,
  })
  .strict();

export type NormalizedCreateOrderIntentBody = z.infer<typeof CreateOrderIntentBodySchema>;
