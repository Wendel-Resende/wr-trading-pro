import { z } from 'zod';
import { parseInstant } from '../../../domain/v1/time';
import { hasAtMostMillisecondPrecision } from '../agent-run/timestamps';

/**
 * Zod strict validation at the risk-policy adapter boundary. Every value
 * entering the repository (submission, evaluation request) passes
 * through here first; nothing free-form crosses into Prisma.
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

export const RequestedBySchema = z.string().min(1).max(200);

export const DirectionSchema = z.enum(['BUY', 'SELL', 'HOLD']);

export const TradeProposalSchema = z
  .object({
    kind: z.literal('PROPOSAL'),
    instrumentId: z.string().min(1).max(64),
    direction: DirectionSchema,
    rationale: z.string().min(1),
    risks: z.array(z.string().min(1)),
    confidence: z.number().min(0).max(1),
    decisionTime: TimestampSchema,
    requiresHumanApproval: z.literal(true),
  })
  .strict();

export const RiskLimitsSchema = z
  .object({
    maxNotional: z.number().finite().gt(0),
    maxPositionConcentrationPct: z.number().finite().gt(0).lte(100),
    maxProposalsPerRun: z.number().int().min(1),
    instrumentAllowlist: z.array(z.string().min(1).max(64)).min(1),
  })
  .strict();

export const RiskEvaluationContextSchema = z
  .object({
    referencePrice: z.number().finite().gt(0),
    proposedQuantity: z.number().finite().min(0),
    currentPositionQty: z.number().finite().min(0),
    portfolioNav: z.number().finite().gt(0),
    limits: RiskLimitsSchema,
  })
  .strict();

export const RiskDecisionOutcomeSchema = z.enum(['APPROVED', 'REJECTED']);

export const RiskDecisionReasonCodeSchema = z.enum([
  'KILL_SWITCH_DISABLED',
  'INSTRUMENT_NOT_ALLOWED',
  'NO_ACTIONABLE_DIRECTION',
  'MAX_PROPOSALS_PER_RUN',
  'NOTIONAL_EXCEEDS_MAX',
  'CONCENTRATION_EXCEEDS_MAX',
  'OK',
]);

export const RiskEvaluateBodySchema = z
  .object({
    runId: z.string().min(1).max(200),
    proposal: TradeProposalSchema,
    context: RiskEvaluationContextSchema,
    decisionTime: TimestampSchema,
  })
  .strict();

export type NormalizedRiskEvaluateBody = z.infer<typeof RiskEvaluateBodySchema>;
