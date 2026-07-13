import { z } from 'zod';
import { compareInstants, parseInstant } from '../../../domain/v1/time';
import {
  normalizeAccountCode,
  normalizeCurrency,
  normalizeCvmCode,
  normalizeCvmProtocol,
  normalizeSha256,
  normalizeShareClass,
  normalizeSourceKey,
} from './normalize';
import { hasAtMostMillisecondPrecision, isValidCivilDate } from './timestamps';

/**
 * Zod strict validation at the CVM adapter boundary. Every value entering
 * the unit of work or leaving the read repositories as a "view" argument
 * passes through here first.
 */

export const SQLITE_MIN_INT64 = BigInt('-9223372036854775808');
export const SQLITE_MAX_INT64 = BigInt('9223372036854775807');

export const TimestampSchema = z
  .string()
  .min(1)
  .max(40)
  .refine((value) => parseInstant(value) !== null, 'timestamp ISO-8601 inválido: exige offset explícito e calendário real')
  .refine(
    hasAtMostMillisecondPrecision,
    'timestamp não pode ter mais de 3 dígitos de fração: precisão máxima persistida é milissegundo',
  );

export const CivilDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'data civil deve estar no formato YYYY-MM-DD')
  .refine(isValidCivilDate, 'data civil inválida (calendário)');

export const IngestionRunIdSchema = z.string().min(1).max(64);

export const SourceKeySchema = z
  .string()
  .min(1)
  .max(200)
  .transform(normalizeSourceKey)
  .refine((value) => /^[a-z0-9:._/-]{1,128}$/.test(value), 'sourceKey normalizado inválido');

export const CvmCodeSchema = z
  .string()
  .min(1)
  .max(32)
  .transform(normalizeCvmCode)
  .refine((value) => /^[0-9]{1,20}$/.test(value), 'cvmCode normalizado inválido');

export const CvmProtocolSchema = z
  .string()
  .min(1)
  .max(64)
  .transform(normalizeCvmProtocol)
  .refine((value) => value.length > 0, 'cvmProtocol não pode ser vazio após normalização');

export const Sha256Schema = z
  .string()
  .transform(normalizeSha256)
  .refine((value) => /^[0-9a-f]{64}$/.test(value), 'rawSha256 deve ter exatamente 64 caracteres hexadecimais minúsculos');

export const SourceUrlSchema = z
  .string()
  .min(1)
  .max(2048)
  .url('sourceUrl deve ser uma URL válida')
  .refine((value) => {
    try {
      const protocol = new URL(value).protocol;
      return protocol === 'https:' || protocol === 'http:';
    } catch {
      return false;
    }
  }, 'sourceUrl deve usar uma URL HTTP ou HTTPS válida');

const DocumentTypeSchema = z.enum(['DFP', 'ITR', 'FRE']);

export const SummarySchema = z
  .string()
  .min(1)
  .max(20_000)
  .refine((value) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      return false;
    }
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
  }, 'summary deve ser uma string contendo um objeto JSON (não escalar, array ou null)');

const CvmFilingSubmissionBaseSchema = z.object({
  issuerCvmCode: CvmCodeSchema,
  documentType: DocumentTypeSchema,
  cvmProtocol: CvmProtocolSchema,
  referenceDate: CivilDateSchema,
  fiscalYear: z.number().int().min(1900).max(9999),
  fiscalQuarter: z.number().int().min(1).max(4).nullish(),
  filedAt: TimestampSchema,
  publishedAt: TimestampSchema,
  isRestatement: z.boolean(),
  supersedesCvmProtocol: CvmProtocolSchema.nullish(),
  sourceUrl: SourceUrlSchema,
  rawSha256: Sha256Schema,
});

export const CvmFilingSubmissionSchema = CvmFilingSubmissionBaseSchema.strict().superRefine((value, ctx) => {
  if (value.isRestatement && !value.supersedesCvmProtocol) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'retificação (isRestatement=true) exige supersedesCvmProtocol',
      path: ['supersedesCvmProtocol'],
    });
  }
  if (!value.isRestatement && value.supersedesCvmProtocol) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'primeira versão (isRestatement=false) não pode declarar supersedesCvmProtocol',
      path: ['supersedesCvmProtocol'],
    });
  }
  if (value.fiscalYear !== Number(value.referenceDate.slice(0, 4))) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'fiscalYear deve corresponder ao ano de referenceDate',
      path: ['fiscalYear'],
    });
  }
  if (value.documentType === 'ITR') {
    if (value.fiscalQuarter == null || value.fiscalQuarter > 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'ITR exige fiscalQuarter entre 1 e 3',
        path: ['fiscalQuarter'],
      });
    }
  } else if (value.fiscalQuarter != null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'DFP/FRE exigem fiscalQuarter nulo',
      path: ['fiscalQuarter'],
    });
  }
});

const StatementTypeSchema = z.enum(['BPA', 'BPP', 'DRE', 'DFC_MD', 'DFC_MI', 'DVA', 'DMPL']);
const ScopeSchema = z.enum(['CON', 'IND']);
const DurationTypeSchema = z.enum(['INSTANT', 'DURATION']);
const AccountCodeSchema = z
  .string()
  .min(1)
  .max(64)
  .transform(normalizeAccountCode)
  .refine((value) => value.length > 0, 'accountCode não pode ser vazio após normalização');
const AccountLabelSchema = z.string().trim().min(1).max(512);
const CurrencySchema = z
  .string()
  .min(1)
  .max(8)
  .transform(normalizeCurrency)
  .refine((value) => /^[A-Z]{3}$/.test(value), 'currency deve ser um código ISO-4217 de 3 letras');
const QualitySchema = z.enum(['AUDITED', 'REVIEWED', 'UNAUDITED', 'RESTATED']);
const OriginalScaleSchema = z.enum(['UNIT', 'THOUSAND', 'MILLION']);
const ValueRawSchema = z.bigint().min(SQLITE_MIN_INT64).max(SQLITE_MAX_INT64);
const ScalePowSchema = z.number().int().min(-18).max(18);

export const CvmFactSubmissionSchema = z
  .object({
    filingCvmProtocol: CvmProtocolSchema,
    statementType: StatementTypeSchema,
    scope: ScopeSchema,
    accountCode: AccountCodeSchema,
    accountLabel: AccountLabelSchema,
    periodStart: CivilDateSchema,
    periodEnd: CivilDateSchema,
    durationType: DurationTypeSchema,
    valueRaw: ValueRawSchema,
    scalePow: ScalePowSchema,
    originalScale: OriginalScaleSchema,
    currency: CurrencySchema,
    quality: QualitySchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.durationType === 'INSTANT' && value.periodStart !== value.periodEnd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'INSTANT exige periodStart === periodEnd',
        path: ['periodEnd'],
      });
    }
    if (value.durationType === 'DURATION' && value.periodStart > value.periodEnd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'DURATION exige periodStart <= periodEnd',
        path: ['periodEnd'],
      });
    }
  });

const ShareClassSchema = z
  .string()
  .min(1)
  .max(32)
  .transform(normalizeShareClass)
  .refine((value) => /^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(value), 'shareClass normalizada inválida');
const QuantityTypeSchema = z.enum(['ISSUED', 'OUTSTANDING', 'TREASURY']);
const QuantitySchema = z.bigint().min(BigInt(0)).max(SQLITE_MAX_INT64);

export const ShareCapitalFactSubmissionSchema = z
  .object({
    filingCvmProtocol: CvmProtocolSchema,
    shareClass: ShareClassSchema,
    periodStart: CivilDateSchema,
    periodEnd: CivilDateSchema,
    quantity: QuantitySchema,
    quantityType: QuantityTypeSchema,
    quality: QualitySchema,
  })
  .strict()
  .refine((value) => value.periodStart === value.periodEnd, {
    message: 'ShareCapitalFact exige periodStart === periodEnd',
    path: ['periodEnd'],
  });

export const CvmIngestionBatchSchema = z
  .object({
    filings: z.array(CvmFilingSubmissionSchema).max(10_000),
    facts: z.array(CvmFactSubmissionSchema).max(50_000),
    shareCapitalFacts: z.array(ShareCapitalFactSubmissionSchema).max(10_000),
  })
  .strict();

export const CvmPointInTimeViewSchema = z
  .object({
    decisionTime: TimestampSchema,
    knowledgeTime: TimestampSchema,
  })
  .strict()
  .refine((value) => compareInstants(parseInstant(value.knowledgeTime)!, parseInstant(value.decisionTime)!) <= 0, {
    message: 'knowledgeTime não pode ser posterior a decisionTime',
    path: ['knowledgeTime'],
  });

export const IssuerIdSchema = z.string().min(1).max(64);

export const CvmFactQuerySchema = z
  .object({
    issuerId: IssuerIdSchema,
    statementType: StatementTypeSchema.optional(),
    scope: ScopeSchema.optional(),
    accountCode: AccountCodeSchema.optional(),
    periodFrom: CivilDateSchema.optional(),
    periodTo: CivilDateSchema.optional(),
  })
  .strict()
  .refine((value) => !value.periodFrom || !value.periodTo || value.periodFrom <= value.periodTo, {
    message: 'periodFrom não pode ser posterior a periodTo',
    path: ['periodTo'],
  });

export const ShareCapitalFactQuerySchema = z
  .object({
    issuerId: IssuerIdSchema,
    shareClass: ShareClassSchema.optional(),
    quantityType: QuantityTypeSchema.optional(),
    periodFrom: CivilDateSchema.optional(),
    periodTo: CivilDateSchema.optional(),
  })
  .strict()
  .refine((value) => !value.periodFrom || !value.periodTo || value.periodFrom <= value.periodTo, {
    message: 'periodFrom não pode ser posterior a periodTo',
    path: ['periodTo'],
  });

export type NormalizedCvmFilingSubmission = z.infer<typeof CvmFilingSubmissionSchema>;
export type NormalizedCvmFactSubmission = z.infer<typeof CvmFactSubmissionSchema>;
export type NormalizedShareCapitalFactSubmission = z.infer<typeof ShareCapitalFactSubmissionSchema>;
export type NormalizedCvmIngestionBatch = z.infer<typeof CvmIngestionBatchSchema>;
export type NormalizedCvmPointInTimeView = z.infer<typeof CvmPointInTimeViewSchema>;
