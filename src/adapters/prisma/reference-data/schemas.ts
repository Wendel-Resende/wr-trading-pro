import { z } from 'zod';
import { parseInstant } from '../../../domain/v1/time';
import {
  normalizeCnpj,
  normalizeCurrency,
  normalizeCvmCode,
  normalizeExchange,
  normalizeSourceKey,
  normalizeSymbol,
} from './normalize';
import { hasAtMostMillisecondPrecision } from './timestamps';

/**
 * Zod strict validation at the reference-data adapter boundary. Every
 * value entering the unit of work or leaving the read repositories as
 * a "view" argument passes through here first; nothing downstream may
 * assume shape without this having run.
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

export const IngestionRunStatusSchema = z.enum(['RUNNING', 'SUCCEEDED', 'FAILED']);

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

export const CnpjSchema = z
  .string()
  .min(1)
  .max(32)
  .transform(normalizeCnpj)
  .refine((value) => /^[0-9]{14}$/.test(value), 'cnpj deve conter exatamente 14 dígitos após normalização');

export const SymbolSchema = z
  .string()
  .min(1)
  .max(32)
  .transform(normalizeSymbol)
  .refine((value) => /^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(value), 'symbol normalizado inválido');

export const ExchangeSchema = z
  .string()
  .min(1)
  .max(32)
  .transform(normalizeExchange)
  .refine((value) => /^[A-Z0-9][A-Z0-9._-]{0,15}$/.test(value), 'exchange normalizado inválido');

export const CurrencySchema = z
  .string()
  .min(1)
  .max(8)
  .transform(normalizeCurrency)
  .refine((value) => /^[A-Z]{3}$/.test(value), 'currency deve ser um código ISO-4217 de 3 letras');

const NameSchema = z.string().trim().min(1).max(256);
const AssetClassSchema = z.enum(['equity', 'future', 'option', 'currency', 'fixed-income', 'fund', 'index', 'other']);
const LifecycleStatusSchema = z.enum(['ACTIVE', 'SUSPENDED', 'DELISTED']);
const ScalePowSchema = z.number().int().min(-12).max(12).nullable();
const LotSizeSchema = z.number().int().positive().max(1_000_000_000).nullable();

/**
 * `summary` is a JSON-serialized string (per `IngestionRun.summary` doc
 * comment in prisma/schema.prisma: "JSON com resumo do lote"). Bounded
 * length and validated as parseable JSON that decodes to a plain object —
 * a bare scalar (string/number/boolean), `null`, or a top-level array is
 * rejected, since none of those are "um resumo" with named fields. The
 * wire/storage representation stays a plain string (the serialized JSON),
 * never a parsed object, so it round-trips unchanged through Prisma.
 */
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

export const IssuerRegistrationSchema = z
  .object({
    cvmCode: CvmCodeSchema,
    cnpj: CnpjSchema.nullish(),
    name: NameSchema,
  })
  .strict();

const InstrumentVersionCommonFields = {
  symbol: SymbolSchema,
  exchange: ExchangeSchema,
  currency: CurrencySchema,
  displayName: NameSchema,
  assetClass: AssetClassSchema,
  status: LifecycleStatusSchema,
  priceScalePow: ScalePowSchema.optional(),
  quantityScalePow: ScalePowSchema.optional(),
  lotSize: LotSizeSchema.optional(),
  issuerCvmCode: CvmCodeSchema.nullish(),
};

const SourceEffectiveInstrumentVersionInputSchema = z
  .object({
    ...InstrumentVersionCommonFields,
    validFromBasis: z.literal('SOURCE_EFFECTIVE'),
    validFrom: TimestampSchema,
  })
  .strict();

const ObservedAtInstrumentVersionInputSchema = z
  .object({
    ...InstrumentVersionCommonFields,
    validFromBasis: z.literal('OBSERVED_AT'),
    validFrom: TimestampSchema.optional(),
  })
  .strict();

/** Mirrors the InstrumentVersionInput discriminated union: validFrom is required only for SOURCE_EFFECTIVE. */
export const InstrumentVersionInputSchema = z.discriminatedUnion('validFromBasis', [
  SourceEffectiveInstrumentVersionInputSchema,
  ObservedAtInstrumentVersionInputSchema,
]);

export const ReferenceDataBatchSchema = z
  .object({
    issuers: z.array(IssuerRegistrationSchema).max(10_000),
    instrumentVersions: z.array(InstrumentVersionInputSchema).max(10_000),
  })
  .strict();

export type NormalizedIssuerRegistration = z.infer<typeof IssuerRegistrationSchema>;
export type NormalizedInstrumentVersionInput = z.infer<typeof InstrumentVersionInputSchema>;
export type NormalizedReferenceDataBatch = z.infer<typeof ReferenceDataBatchSchema>;
