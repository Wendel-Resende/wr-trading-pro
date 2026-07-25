import { z } from 'zod';

/**
 * Item D — validação de fronteira do adapter Prisma.
 *
 * `metrics`/`topFeatures`/`gateFailures` são colunas TEXT com JSON (SQLite não
 * tem tipo nativo). Nada que sai do banco é confiado pela forma: todo blob
 * passa por estes schemas antes de virar objeto de domínio. Um registro
 * corrompido falha explicitamente na leitura, nunca vira `undefined`
 * silencioso no meio da UI.
 */

/** 64 hex minúsculos, sem prefixo — mesmo formato do motor Python. */
export const ModelVersionIdSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const DirectionalSignalSchema = z.enum(['COMPRA', 'VENDA', 'NEUTRO']);
export const DirectionalModelStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'FAILED', 'SUPERSEDED']);
export const DirectionalGateFailureCodeSchema = z.enum([
  'ACCURACY_BELOW_MIN',
  'BRIER_ABOVE_MAX',
  'COVERAGE_BELOW_MIN',
  'BASELINE_DELTA_BELOW_MIN',
]);

const FiniteNumber = z.number().finite();
const Probability = FiniteNumber.min(0).max(1);

export const DirectionalMetricsSchema = z.object({
  nSamples: z.number().int().nonnegative(),
  nHighConfidence: z.number().int().nonnegative(),
  // Acurácia pode ser NaN quando não houve NENHUM sinal de alta confiança —
  // o motor devolve `null` nesse caso (JSON não representa NaN) e o gate
  // reprova por cobertura. Aceitar null aqui é honesto; inventar 0 não seria.
  accuracy: Probability.nullable(),
  accuracyAllSamples: Probability,
  brier: FiniteNumber.min(0).max(1),
  coverage: z.number().int().nonnegative(),
  coveragePeriod: z.string().max(20).nullable(),
  baselineAllUp: Probability,
  baselineOnSignals: Probability.nullable(),
  baselineDelta: FiniteNumber.min(-1).max(1).nullable(),
  // Evidência da calibração (2026-07-25). `brierRaw`/`nHighConfidenceRaw` são
  // as MESMAS métricas medidas sobre a probabilidade ANTES do mapa de
  // calibração — é o que torna o ganho (ou a ausência dele) auditável em vez
  // de apenas afirmado. Opcionais: artefatos treinados antes desta mudança
  // não os têm.
  calibrated: z.boolean().optional(),
  brierRaw: FiniteNumber.min(0).max(1).nullable().optional(),
  nHighConfidenceRaw: z.number().int().nonnegative().nullable().optional(),
  confusionMatrix: z.object({
    truePositive: z.number().int().nonnegative(),
    falsePositive: z.number().int().nonnegative(),
    trueNegative: z.number().int().nonnegative(),
    falseNegative: z.number().int().nonnegative(),
  }),
  reliability: z
    .array(
      z.object({
        binStart: Probability,
        binEnd: Probability,
        n: z.number().int().nonnegative(),
        meanPredicted: Probability.nullable(),
        observedRate: Probability.nullable(),
      }),
    )
    .max(100),
  byFold: z
    .array(
      z.object({
        foldId: z.number().int().nonnegative(),
        testYear: z.number().int(),
        n: z.number().int().nonnegative(),
        nHighConfidence: z.number().int().nonnegative(),
        accuracy: Probability.nullable(),
        brier: FiniteNumber.min(0).max(1),
      }),
    )
    .max(100),
});

export const DirectionalTopFeaturesSchema = z
  .array(z.object({ feature: z.string().max(200), importance: FiniteNumber }))
  .max(20);

export const DirectionalModelVersionSubmissionSchema = z.object({
  modelVersion: ModelVersionIdSchema,
  researchRunId: z.string().min(1).max(200),
  metrics: DirectionalMetricsSchema,
  artifactPath: z.string().min(1).max(1000),
  status: DirectionalModelStatusSchema,
  gateFailures: z.array(DirectionalGateFailureCodeSchema).max(10),
});

export const DirectionalPredictionSubmissionSchema = z.object({
  modelVersion: ModelVersionIdSchema,
  cdCvm: z.string().min(1).max(20),
  ticker: z.string().min(1).max(20),
  signal: DirectionalSignalSchema,
  confidence: Probability,
  prob: Probability,
  knowledgeDate: z.string().min(1),
  topFeatures: DirectionalTopFeaturesSchema,
  universeDigest: ModelVersionIdSchema,
  generatedAt: z.string().min(1),
});
