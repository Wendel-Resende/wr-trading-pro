import { z } from 'zod';
import { compareInstants, parseInstant } from '../../../domain/v1/time';
import { hasAtMostMillisecondPrecision } from './timestamps';

/**
 * Zod strict validation at the agent-run adapter boundary. Every value
 * entering the repository (submission, query, transition detail) passes
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

export const AgentRunKindSchema = z.enum(['RESEARCH', 'PROPOSAL']);

export const AgentRunStatusSchema = z.enum(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED']);

export const AgentRunDagSchema = z
  .object({
    nodes: z.array(z.string().min(1)).min(1),
    edges: z.array(z.tuple([z.string().min(1), z.string().min(1)])),
  })
  .strict();

export const AgentRunBudgetSchema = z
  .object({
    maxSteps: z.number().int().min(1).max(10_000).optional(),
    maxCost: z.number().min(0).optional(),
    timeoutMs: z.number().int().min(1).max(3_600_000).optional(),
  })
  .strict();

export const AgentRunInputSchema = z.record(z.unknown());

export const RequestedBySchema = z.string().min(1).max(200);

export const AgentRunSubmissionSchema = z
  .object({
    requestedBy: RequestedBySchema,
    kind: AgentRunKindSchema,
    dag: AgentRunDagSchema,
    input: AgentRunInputSchema,
    budget: AgentRunBudgetSchema,
    decisionTime: TimestampSchema,
    knowledgeTime: TimestampSchema,
  })
  .strict()
  .refine((value) => compareInstants(parseInstant(value.knowledgeTime)!, parseInstant(value.decisionTime)!) <= 0, {
    message: 'knowledgeTime não pode ser posterior a decisionTime',
    path: ['knowledgeTime'],
  });

export const AgentRunListQuerySchema = z
  .object({
    requestedBy: RequestedBySchema.optional(),
    status: AgentRunStatusSchema.optional(),
    limit: z.number().int().min(1).max(1000).optional(),
    offset: z.number().int().min(0).optional(),
  })
  .strict();

const EvidenceItemSchema = z
  .object({
    source: z.string().min(1),
    reference: z.string().min(1),
    asOf: TimestampSchema,
  })
  .strict();

export const ResearchFindingSchema = z
  .object({
    kind: z.literal('RESEARCH'),
    thesis: z.string().min(1),
    evidence: z.array(EvidenceItemSchema),
    risks: z.array(z.string().min(1)),
    confidence: z.number().min(0).max(1),
    decisionTime: TimestampSchema,
    invalidation: z.string().min(1),
  })
  .strict();

export const TradeProposalSchema = z
  .object({
    kind: z.literal('PROPOSAL'),
    instrumentId: z.string().min(1),
    direction: z.enum(['BUY', 'SELL', 'HOLD']),
    rationale: z.string().min(1),
    risks: z.array(z.string().min(1)),
    confidence: z.number().min(0).max(1),
    decisionTime: TimestampSchema,
    requiresHumanApproval: z.literal(true),
  })
  .strict();

export const AgentRunOutputSchema = z.discriminatedUnion('kind', [ResearchFindingSchema, TradeProposalSchema]);

export type NormalizedAgentRunSubmission = z.infer<typeof AgentRunSubmissionSchema>;
export type NormalizedAgentRunListQuery = z.infer<typeof AgentRunListQuerySchema>;
