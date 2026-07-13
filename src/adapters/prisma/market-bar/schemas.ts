import { z } from 'zod';
import { compareInstants, parseInstant } from '../../../domain/v1/time';
import { normalizeSha256, normalizeSourceKey, normalizeSourceRecordKey } from './normalize';
import { hasAtMostMillisecondPrecision } from './timestamps';

/**
 * Zod strict validation at the market-bar adapter boundary. Every value
 * entering the unit of work or leaving the read repository as a "view"
 * argument passes through here first.
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

export const IngestionRunIdSchema = z.string().min(1).max(64);

export const InstrumentVersionIdSchema = z.string().min(1).max(64);

export const SourceKeySchema = z
  .string()
  .min(1)
  .max(200)
  .transform(normalizeSourceKey)
  .refine((value) => /^[a-z0-9:._/-]{1,128}$/.test(value), 'sourceKey normalizado inválido');

export const SourceRecordKeySchema = z
  .string()
  .min(1)
  .max(256)
  .transform(normalizeSourceRecordKey)
  .refine((value) => value.length > 0, 'sourceRecordKey não pode ser vazio após normalização');

export const Sha256Schema = z
  .string()
  .transform(normalizeSha256)
  .refine((value) => /^[0-9a-f]{64}$/.test(value), 'rawSha256 deve ter exatamente 64 caracteres hexadecimais minúsculos');

export const TimeframeSchema = z.enum(['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w']);
export const VolumeSemanticsSchema = z.enum(['TICKS', 'CONTRACTS', 'SHARES', 'NOTIONAL']);
export const PriceBasisSchema = z.enum(['TRADE', 'MID', 'BID', 'ASK']);
export const QualitySchema = z.enum(['FINAL', 'PROVISIONAL', 'ESTIMATED', 'CORRECTED']);

const PriceScalePowSchema = z.number().int().min(-18).max(18);
const VolumeScalePowSchema = z.number().int().min(-18).max(18);
// Esta fundação persiste apenas barras fechadas de instrumentos B3/feeds
// governados; OHLC zero não representa preço negociável válido e falha
// fechado em vez de ser interpretado como ausência de dado.
const PriceRawSchema = z.bigint().min(BigInt(1)).max(SQLITE_MAX_INT64);
const VolumeRawSchema = z.bigint().min(BigInt(0)).max(SQLITE_MAX_INT64);
const TradeCountSchema = z.bigint().min(BigInt(0)).max(SQLITE_MAX_INT64).nullish();

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

export const MarketBarSubmissionSchema = z
  .object({
    instrumentVersionId: InstrumentVersionIdSchema,
    sourceRecordKey: SourceRecordKeySchema,
    timeframe: TimeframeSchema,
    openedAt: TimestampSchema,
    closedAt: TimestampSchema,
    sourceAvailableAt: TimestampSchema,
    openRaw: PriceRawSchema,
    highRaw: PriceRawSchema,
    lowRaw: PriceRawSchema,
    closeRaw: PriceRawSchema,
    priceScalePow: PriceScalePowSchema,
    volumeRaw: VolumeRawSchema,
    volumeScalePow: VolumeScalePowSchema,
    volumeSemantics: VolumeSemanticsSchema,
    tradeCount: TradeCountSchema,
    priceBasis: PriceBasisSchema,
    quality: QualitySchema,
    rawSha256: Sha256Schema,
    isRevision: z.boolean(),
    supersedesSourceRecordKey: SourceRecordKeySchema.nullish(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.isRevision && !value.supersedesSourceRecordKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'revisão (isRevision=true) exige supersedesSourceRecordKey',
        path: ['supersedesSourceRecordKey'],
      });
    }
    if (!value.isRevision && value.supersedesSourceRecordKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'root (isRevision=false) não pode declarar supersedesSourceRecordKey',
        path: ['supersedesSourceRecordKey'],
      });
    }
    // OHLC cross-validation.
    if (value.highRaw < value.openRaw || value.highRaw < value.closeRaw || value.highRaw < value.lowRaw) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'highRaw deve ser >= open/close/low', path: ['highRaw'] });
    }
    if (value.lowRaw > value.openRaw || value.lowRaw > value.closeRaw || value.lowRaw > value.highRaw) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'lowRaw deve ser <= open/close/high', path: ['lowRaw'] });
    }
    // openedAt < closedAt.
    const openedAtInstant = parseInstant(value.openedAt);
    const closedAtInstant = parseInstant(value.closedAt);
    if (openedAtInstant && closedAtInstant && compareInstants(openedAtInstant, closedAtInstant) >= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'openedAt deve ser estritamente anterior a closedAt', path: ['closedAt'] });
    }
    // closedAt <= sourceAvailableAt.
    const sourceAvailableAtInstant = parseInstant(value.sourceAvailableAt);
    if (closedAtInstant && sourceAvailableAtInstant && compareInstants(closedAtInstant, sourceAvailableAtInstant) > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'closedAt deve ser <= sourceAvailableAt',
        path: ['sourceAvailableAt'],
      });
    }
  });

export const MarketBarIngestionBatchSchema = z
  .object({
    bars: z.array(MarketBarSubmissionSchema).max(50_000),
  })
  .strict();

export const MarketBarRangeSchema = z
  .object({ from: TimestampSchema, to: TimestampSchema })
  .strict()
  .refine((value) => compareInstants(parseInstant(value.from)!, parseInstant(value.to)!) < 0, {
    message: 'from deve ser estritamente anterior a to',
    path: ['to'],
  });

export const MarketBarPointInTimeViewSchema = z
  .object({
    decisionTime: TimestampSchema,
    knowledgeTime: TimestampSchema,
  })
  .strict()
  .refine((value) => compareInstants(parseInstant(value.knowledgeTime)!, parseInstant(value.decisionTime)!) <= 0, {
    message: 'knowledgeTime não pode ser posterior a decisionTime',
    path: ['knowledgeTime'],
  });

export type NormalizedMarketBarSubmission = z.infer<typeof MarketBarSubmissionSchema>;
export type NormalizedMarketBarIngestionBatch = z.infer<typeof MarketBarIngestionBatchSchema>;
export type NormalizedMarketBarPointInTimeView = z.infer<typeof MarketBarPointInTimeViewSchema>;
