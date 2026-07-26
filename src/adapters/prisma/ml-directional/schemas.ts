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
  // Gate de classificação (histórico — versões antigas têm estes persistidos).
  'ACCURACY_BELOW_MIN',
  'BRIER_ABOVE_MAX',
  'COVERAGE_BELOW_MIN',
  'BASELINE_DELTA_BELOW_MIN',
  // Gate de ranking (atual).
  'IC_BELOW_MIN',
  'IC_TSTAT_BELOW_MIN',
  'TOP_QUANTILE_EXCESS_BELOW_MIN',
  'TOP_BOTTOM_SPREAD_BELOW_MIN',
  'INCONSISTENT_ACROSS_YEARS',
]);

const FiniteNumber = z.number().finite();
const Probability = FiniteNumber.min(0).max(1);

export const DirectionalMetricsSchema = z.object({
  nSamples: z.number().int().nonnegative(),
  // Métricas do motor de CLASSIFICAÇÃO (até 2026-07-25). Opcionais: o escore
  // composto ordena empresas e não estima probabilidade, então não emite
  // acurácia, Brier, cobertura, matriz de confusão nem confiabilidade —
  // reportar Brier de algo que não é probabilidade seria inventar calibração.
  // Seguem no contrato para que as versões antigas continuem legíveis.
  nHighConfidence: z.number().int().nonnegative().optional(),
  nPeriods: z.number().int().nonnegative().optional(),
  nFeaturesMedian: z.number().int().nonnegative().nullable().optional(),
  // Acurácia pode ser NaN quando não houve NENHUM sinal de alta confiança —
  // o motor devolve `null` nesse caso (JSON não representa NaN) e o gate
  // reprova por cobertura. Aceitar null aqui é honesto; inventar 0 não seria.
  accuracy: Probability.nullable().optional(),
  accuracyAllSamples: Probability.optional(),
  brier: FiniteNumber.min(0).max(1).optional(),
  coverage: z.number().int().nonnegative().optional(),
  coveragePeriod: z.string().max(20).nullable().optional(),
  baselineAllUp: Probability.optional(),
  baselineOnSignals: Probability.nullable().optional(),
  baselineDelta: FiniteNumber.min(-1).max(1).nullable().optional(),
  // Evidência da calibração (2026-07-25). `brierRaw`/`nHighConfidenceRaw` são
  // as MESMAS métricas medidas sobre a probabilidade ANTES do mapa de
  // calibração — é o que torna o ganho (ou a ausência dele) auditável em vez
  // de apenas afirmado. Opcionais: artefatos treinados antes desta mudança
  // não os têm.
  calibrated: z.boolean().optional(),
  brierRaw: FiniteNumber.min(0).max(1).nullable().optional(),
  nHighConfidenceRaw: z.number().int().nonnegative().nullable().optional(),
  // Métricas de ranking (instrumento atual). Opcionais: versões treinadas
  // antes de 2026-07-25 não as têm, e a auditoria precisa continuar legível.
  ic: FiniteNumber.min(-1).max(1).nullable().optional(),
  icTStat: FiniteNumber.nullable().optional(),
  icPeriods: z.number().int().nonnegative().optional(),
  quantileExcess: z
    .array(z.object({
      quantile: z.number().int().positive(),
      n: z.number().int().nonnegative(),
      meanExcess: FiniteNumber,
      hitRate: Probability,
    }))
    .max(20)
    .optional(),
  topBottomSpread: FiniteNumber.nullable().optional(),
  spreadByYear: z.array(z.object({ testYear: z.number().int(), spread: FiniteNumber })).max(50).optional(),
  positiveYearsRatio: Probability.nullable().optional(),
  // Economia líquida (custos aplicados no servidor).
  roundTripCost: FiniteNumber.min(0).max(1).optional(),
  netQuantileExcess: z
    .array(z.object({
      quantile: z.number().int().positive(),
      n: z.number().int().nonnegative(),
      meanExcess: FiniteNumber,
      hitRate: Probability,
    }))
    .max(20)
    .optional(),
  netTopBottomSpread: FiniteNumber.nullable().optional(),
  confusionMatrix: z.object({
    truePositive: z.number().int().nonnegative(),
    falsePositive: z.number().int().nonnegative(),
    trueNegative: z.number().int().nonnegative(),
    falseNegative: z.number().int().nonnegative(),
  }).optional(),
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
    .max(100)
    .optional(),
  byFold: z
    .array(
      z.object({
        foldId: z.number().int().nonnegative(),
        testYear: z.number().int(),
        n: z.number().int().nonnegative(),
        // Fator (atual):
        nFeatures: z.number().int().nonnegative().nullable().optional(),
        ic: FiniteNumber.min(-1).max(1).nullable().optional(),
        // Classificação (versões antigas):
        nHighConfidence: z.number().int().nonnegative().optional(),
        accuracy: Probability.nullable().optional(),
        brier: FiniteNumber.min(0).max(1).optional(),
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
  score: FiniteNumber.nullable().optional(),
  quantile: z.number().int().positive().max(20).nullable().optional(),
  knowledgeDate: z.string().min(1),
  topFeatures: DirectionalTopFeaturesSchema,
  universeDigest: ModelVersionIdSchema,
  generatedAt: z.string().min(1),
});
