import { z } from 'zod';
import { compareInstants, parseInstant } from '../../../domain/v1/time';
import { normalizeFeatureId, normalizeSourceKey, normalizeSubjectId } from './normalize';
import { hasAtMostMillisecondPrecision } from './timestamps';

/**
 * Zod strict validation at the feature-value adapter boundary. The
 * `featureType` literal union below is the structural enforcement that
 * makes `FLOAT` and any scoring/agent-narrative type impossible to
 * submit: only `STRING | BIGINT | DATE | ENUM` type-check, and any
 * externally-sourced payload attempting another value (even via an
 * `as any` cast) is rejected at runtime by this schema.
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

export const FeatureIdSchema = z.string().min(1).max(200).transform(normalizeFeatureId);

export const SubjectIdSchema = z.string().min(1).max(200).transform(normalizeSubjectId);

export const SourceKeySchema = z
  .string()
  .min(1)
  .max(200)
  .transform(normalizeSourceKey)
  .refine((value) => /^[a-z0-9:._/-]{1,128}$/.test(value), 'sourceKey normalizado inválido');

export const FeatureTypeSchema = z.enum(['STRING', 'BIGINT', 'DATE', 'ENUM']);

const ScalePowSchema = z.number().int().min(-18).max(18);

const DateValueRawSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'DATE exige o formato YYYY-MM-DD');

const BigintValueRawSchema = z
  .string()
  .regex(/^-?(0|[1-9]\d*)$/, 'BIGINT exige um inteiro decimal exato (sem ponto/expoente)');

export const FeatureValueSubmissionSchema = z
  .object({
    featureId: FeatureIdSchema,
    subjectId: SubjectIdSchema,
    featureType: FeatureTypeSchema,
    valueRaw: z.string().min(1).max(200),
    scalePow: ScalePowSchema.nullish(),
    enumValue: z.string().min(1).max(200).nullish(),
    label: z.string().min(1).max(500).nullish(),
    knowledgeTime: TimestampSchema,
    decisionTime: TimestampSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (compareInstants(parseInstant(value.knowledgeTime)!, parseInstant(value.decisionTime)!) > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'knowledgeTime não pode ser posterior a decisionTime',
        path: ['knowledgeTime'],
      });
    }
    if (value.featureType === 'BIGINT') {
      if (value.scalePow === null || value.scalePow === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'BIGINT exige scalePow em [-18,18]', path: ['scalePow'] });
      }
      if (!BigintValueRawSchema.safeParse(value.valueRaw).success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'BIGINT exige valueRaw como inteiro decimal exato', path: ['valueRaw'] });
      }
    } else if (value.scalePow !== null && value.scalePow !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `scalePow só é aplicável a featureType=BIGINT`, path: ['scalePow'] });
    }
    if (value.featureType === 'ENUM') {
      if (!value.enumValue) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'ENUM exige enumValue', path: ['enumValue'] });
      }
    } else if (value.enumValue) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `enumValue só é aplicável a featureType=ENUM`, path: ['enumValue'] });
    }
    if (value.featureType === 'DATE' && !DateValueRawSchema.safeParse(value.valueRaw).success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'DATE exige valueRaw no formato YYYY-MM-DD', path: ['valueRaw'] });
    }
  });

export const FeatureValueQuerySchema = z
  .object({
    featureId: FeatureIdSchema.optional(),
    subjectId: SubjectIdSchema.optional(),
    decisionTime: TimestampSchema.optional(),
    knowledgeTime: TimestampSchema.optional(),
    from: TimestampSchema.optional(),
    to: TimestampSchema.optional(),
    limit: z.number().int().min(1).max(5000).optional(),
    offset: z.number().int().min(0).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.decisionTime === undefined
      || value.knowledgeTime === undefined
      || compareInstants(parseInstant(value.knowledgeTime)!, parseInstant(value.decisionTime)!) <= 0,
    { message: 'knowledgeTime não pode ser posterior a decisionTime', path: ['knowledgeTime'] },
  );

export type NormalizedFeatureValueSubmission = z.infer<typeof FeatureValueSubmissionSchema>;
export type NormalizedFeatureValueQuery = z.infer<typeof FeatureValueQuerySchema>;
