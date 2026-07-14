import { z } from 'zod';
import { parseInstant } from '../../../domain/v1/time';
import { hasAtMostMillisecondPrecision } from '../agent-run/timestamps';

/**
 * Zod strict validation at the option-position adapter boundary
 * (Fase 6 — Consolidação). Reuses the same `TimestampSchema` shape as
 * `order-intent`/`market-bar` rather than reinventing timestamp validation.
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

export const OptionKindSchema = z.enum(['CALL', 'PUT']);
export const OptionSideSchema = z.enum(['LONG', 'SHORT']);
export const OptionPositionSourceSchema = z.enum(['MT5', 'MANUAL', 'REPLAY']);

export const CreateOptionPositionBodySchema = z
  .object({
    instrumentId: z.string().min(1).max(64),
    kind: OptionKindSchema,
    strike: z.number().int().min(1),
    expiration: TimestampSchema,
    side: OptionSideSchema,
    quantity: z.number().int().min(1),
    source: OptionPositionSourceSchema,
    knowledgeTime: TimestampSchema,
  })
  .strict();

export type NormalizedCreateOptionPositionBody = z.infer<typeof CreateOptionPositionBodySchema>;

export const ReplayOptionPositionBodySchema = z
  .object({
    instrumentId: z.string().min(1).max(64),
    kind: OptionKindSchema,
    strike: z.number().int().min(1),
    expiration: TimestampSchema,
    decisionTime: TimestampSchema,
    knowledgeTime: TimestampSchema,
    windowFrom: TimestampSchema,
    windowTo: TimestampSchema,
    sourceKey: z.string().min(1).max(64),
    instrumentVersionId: z.string().min(1).max(64),
  })
  .strict();

export type NormalizedReplayOptionPositionBody = z.infer<typeof ReplayOptionPositionBodySchema>;
