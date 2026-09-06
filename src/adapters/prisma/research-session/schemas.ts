import { z } from 'zod';
import { RESEARCH_SESSION_KINDS, RESEARCH_SESSION_STATUSES } from '../../../domain/v1/models/research-session';

export const ResearchSessionKindSchema = z.enum(RESEARCH_SESSION_KINDS);
export const ResearchSessionStatusSchema = z.enum(RESEARCH_SESSION_STATUSES);

export const ResearchSessionSubmissionSchema = z
  .object({
    kind: ResearchSessionKindSchema,
    label: z.string().min(1).max(200),
    notes: z.string().max(4000).nullable(),
    configJson: z.string().min(2).max(2_000_000),
    createdBy: z.string().min(1).max(120),
  })
  .strict();

export const ResearchSessionDraftPatchSchema = z
  .object({
    label: z.string().min(1).max(200).optional(),
    notes: z.string().max(4000).nullable().optional(),
    configJson: z.string().min(2).max(2_000_000).optional(),
  })
  .strict();
