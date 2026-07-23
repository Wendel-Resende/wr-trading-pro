import { z } from 'zod';
import type { PredictLiveResult } from '../../../../../application/ml-hybrid';
import { ReadModelError } from '../../../../../application/read-models-v1';
import { redactUnsafeText } from '../../_shared/sanitize-text';

/**
 * Item B (auditoria focada do Guardião, 2026-07-22, bloqueador 3):
 * `POST /api/v1/ml/predict` repassava o resultado do Python integralmente —
 * `sourceMeta` era `Record<string, unknown>` livre e `topFeatures` conteúdo
 * externo sem validação runtime. Este DTO valida estritamente o shape
 * ANTES de expor qualquer campo publicamente: qualquer valor fora do
 * schema (digest malformado, chave desconhecida em `sourceMeta`, score
 * não-finito) faz a resposta inteira falhar como erro server-side, nunca
 * vaza parcialmente.
 */
const HEX_DIGEST_RE = /^[a-f0-9]{64}$/i;
const TICKER_RE = /^[A-Z]{4}\d{1,2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}(T[\d:.Z+-]+)?$/;
/** Nomes de features vêm do LightGBM (`ALL_FEATURES`, `python/ml/features.py`) — texto interno fixo, nunca do usuário; mesmo assim validado por formato conservador. */
const FEATURE_NAME_RE = /^[A-Za-z0-9_]{1,60}$/;
/**
 * Item B (correção residual, 2026-07-22, ponto 2): IDs canônicos do Prisma
 * (`cuid()`) são alfanuméricos minúsculos — nunca path, token ou texto
 * arbitrário. `modelVersionId`/`signalId` no DTO público precisam bater
 * exatamente com este formato, não apenas ter `min/max`.
 */
const CANONICAL_ID_RE = /^[a-z0-9]{1,64}$/;

function toSafeDigest(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  return HEX_DIGEST_RE.test(raw) ? raw.toLowerCase() : null;
}

const TopFeatureSchema = z.object({
  name: z.string().max(200),
  /** Item B (ponto 3): peso de feature nunca é negativo (LightGBM `feature_importance`). */
  importance: z.number().finite().min(0),
});

const SourceMetaSchema = z
  .object({
    candles: z
      .object({
        from: z.string().max(64).optional(),
        to: z.string().max(64).optional(),
        source: z.string().max(64).optional(),
      })
      .partial()
      .optional(),
    model: z.string().max(200).optional(),
    timesfm: z.string().max(200).optional(),
  })
  .passthrough();

const PredictionSchema = z.object({
  symbol: z.string().max(20),
  date: z.string().max(40),
  direction: z.enum(['BUY', 'SELL', 'HOLD']),
  /** Item B (ponto 3): motor LightGBM binário produz probabilidade — nunca fora de [0, 1]. */
  score: z.number().finite().min(0).max(1),
  topFeatures: z.array(TopFeatureSchema).max(20),
  sourceMeta: SourceMetaSchema,
});

const PredictLiveResultSchema = z.object({
  /** Item B (ponto 2): formato canônico do Prisma (`cuid()`), não apenas min/max. */
  signalId: z.string().regex(CANONICAL_ID_RE),
  prediction: PredictionSchema,
  modelVersionId: z.string().regex(CANONICAL_ID_RE),
  datasetHash: z.string().max(200),
  artifactHash: z.string().max(200),
});

export interface TopFeaturePublicDTO {
  readonly name: string;
  readonly importance: number;
}

export interface PredictionPublicDTO {
  readonly symbol: string;
  readonly date: string;
  readonly direction: 'BUY' | 'SELL' | 'HOLD';
  readonly score: number;
  readonly topFeatures: readonly TopFeaturePublicDTO[];
  readonly sourceMeta: {
    readonly candlesFrom: string | null;
    readonly candlesTo: string | null;
    readonly candlesSource: string | null;
    readonly timesfmVersion: string | null;
  };
}

export interface PredictLivePublicDTO {
  readonly signalId: string;
  readonly prediction: PredictionPublicDTO;
  readonly modelVersionId: string;
  readonly datasetHash: string;
  readonly artifactHash: string;
}

/**
 * Bloqueador 3: transforma o resultado interno em DTO público estritamente
 * allowlisted. Lança `ReadModelError('UPSTREAM_ERROR', …)` — nunca deixa
 * um shape inesperado do Python (ou digest malformado) escapar como 200
 * com dado parcialmente bruto.
 */
export function toPredictLivePublicDTO(result: PredictLiveResult): PredictLivePublicDTO {
  const parsed = PredictLiveResultSchema.safeParse(result);
  if (!parsed.success) {
    throw new ReadModelError('UPSTREAM_ERROR', 'resposta de previsão do motor ML em formato inesperado');
  }
  const data = parsed.data;

  const datasetHash = toSafeDigest(data.datasetHash);
  const artifactHash = toSafeDigest(data.artifactHash);
  if (datasetHash === null || artifactHash === null) {
    throw new ReadModelError('UPSTREAM_ERROR', 'digest de dataset/artefato em formato inválido');
  }

  const symbol = TICKER_RE.test(data.prediction.symbol) ? data.prediction.symbol : 'DESCONHECIDO';
  const date = DATE_RE.test(data.prediction.date) ? data.prediction.date : 'DESCONHECIDO';

  const topFeatures: TopFeaturePublicDTO[] = data.prediction.topFeatures
    .filter((f) => FEATURE_NAME_RE.test(f.name))
    .slice(0, 10)
    .map((f) => ({ name: f.name, importance: f.importance }));

  const meta = data.prediction.sourceMeta;
  const sourceMeta = {
    candlesFrom: meta.candles?.from ? redactUnsafeText(meta.candles.from, 40, '') || null : null,
    candlesTo: meta.candles?.to ? redactUnsafeText(meta.candles.to, 40, '') || null : null,
    candlesSource: meta.candles?.source ? redactUnsafeText(meta.candles.source, 40, '') || null : null,
    timesfmVersion: meta.timesfm ? redactUnsafeText(meta.timesfm, 60, '') || null : null,
  };

  return {
    signalId: data.signalId,
    prediction: {
      symbol,
      date,
      direction: data.prediction.direction,
      score: data.prediction.score,
      topFeatures,
      sourceMeta,
    },
    modelVersionId: data.modelVersionId,
    datasetHash,
    artifactHash,
  };
}
