/**
 * Ranking Fundamentalista — contratos e utilitários compartilhados.
 *
 * Espelham os DTOs públicos de `/api/v1/ml/directional/*` e
 * `/api/v1/ml/training-runs`. Nunca incluem `artifactPath` nem `pythonJobId`
 * (infra interna do servidor).
 *
 * Reposicionamento de 2026-08-11: o motor é um ESCORE COMPOSTO DE FATOR, que
 * ORDENA empresas na seção transversal do trimestre. Ele não prevê direção de
 * preço. Por isso não existe aqui `signal` (COMPRA/VENDA/NEUTRO) nem
 * `confidence` — a posição é o QUINTIL. Ver
 * docs/superpowers/specs/2026-08-11-ranking-fundamentalista-design.md.
 */

export interface GateCheck {
  readonly code: string;
  readonly label: string;
  readonly threshold: number;
  readonly observed: number | null;
  readonly passed: boolean;
}

export interface DirectionalMetrics {
  readonly nSamples: number;
  readonly nPeriods?: number;
  readonly nFeaturesMedian?: number | null;
  // Métricas do motor de classificação anterior — só existem em versões
  // antigas e seguem opcionais para que o histórico continue legível.
  readonly nHighConfidence?: number;
  readonly accuracy?: number | null;
  readonly accuracyAllSamples?: number;
  readonly brier?: number;
  readonly coverage?: number;
  readonly coveragePeriod?: string | null;
  readonly baselineAllUp?: number;
  readonly baselineOnSignals?: number | null;
  readonly baselineDelta?: number | null;
  readonly calibrated?: boolean;
  readonly brierRaw?: number | null;
  readonly nHighConfidenceRaw?: number | null;
  readonly ic?: number | null;
  readonly icTStat?: number | null;
  readonly icPeriods?: number;
  readonly quantileExcess?: readonly QuantileBucket[];
  readonly topBottomSpread?: number | null;
  readonly spreadByYear?: readonly { readonly testYear: number; readonly spread: number }[];
  readonly positiveYearsRatio?: number | null;
  readonly roundTripCost?: number;
  readonly netQuantileExcess?: readonly QuantileBucket[];
  readonly netTopBottomSpread?: number | null;
  readonly confusionMatrix?: {
    readonly truePositive: number;
    readonly falsePositive: number;
    readonly trueNegative: number;
    readonly falseNegative: number;
  };
  readonly reliability?: readonly {
    readonly binStart: number;
    readonly binEnd: number;
    readonly n: number;
    readonly meanPredicted: number | null;
    readonly observedRate: number | null;
  }[];
  readonly byFold: readonly {
    readonly foldId: number;
    readonly testYear: number;
    readonly n: number;
    readonly nFeatures?: number | null;
    readonly ic?: number | null;
    readonly nHighConfidence?: number;
    readonly accuracy?: number | null;
    readonly brier?: number;
  }[];
}

export interface QuantileBucket {
  readonly quantile: number;
  readonly n: number;
  readonly meanExcess: number;
  readonly hitRate: number;
}

export interface DirectionalModel {
  readonly modelVersion: string;
  readonly createdAt: string;
  readonly researchRunId: string;
  readonly status: 'ACTIVE' | 'FAILED' | 'SUPERSEDED';
  readonly gateApproved: boolean;
  readonly gateFailures: readonly string[];
  readonly gateChecks: readonly GateCheck[];
  readonly metrics: DirectionalMetrics;
}

/** Uma linha do ranking. Posição = `quantile`; não há sinal de compra/venda. */
export interface RankingEntry {
  readonly ticker: string;
  readonly cdCvm: string;
  /** Percentil transversal do trimestre (0–1). NÃO é probabilidade. */
  readonly percentil: number;
  /** Escore bruto do fator, centrado em 0. Positivo = acima da mediana das pares. */
  readonly score?: number | null;
  /** Quintil no período: 1 = fundo, 5 = topo. */
  readonly quantile?: number | null;
  readonly knowledgeDate: string;
  readonly topFeatures: readonly { readonly feature: string; readonly importance: number }[];
  readonly modelVersion: string;
  readonly universeDigest: string;
  readonly generatedAt: string;
}

export interface CostProfile {
  readonly id: string;
  readonly version: number;
  readonly label: string;
}

/** Espelha `MlTrainingRunPublicDTO` — nunca `pythonJobId`. */
export interface TrainingRun {
  readonly trainingRunId: string;
  readonly status:
    | 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'REJECTED'
    | 'FAILED' | 'CANCEL_REQUESTED' | 'CANCELLED' | 'INTERRUPTED';
  readonly phase: 'QUEUED' | 'SNAPSHOT' | 'DATASET' | 'TRAINING' | 'GATE' | 'FINALIZING';
  readonly progress: number;
  readonly researchRunId: string | null;
  readonly modelVersionId: string | null;
  readonly gate: { readonly approved: boolean; readonly checks: readonly GateCheck[] } | null;
  readonly metrics: {
    readonly nSamples: number;
    readonly nHighConfidence: number;
    readonly nPeriods?: number;
    readonly ic?: number | null;
    readonly icTStat?: number | null;
    readonly topBottomSpread?: number | null;
    readonly positiveYearsRatio?: number | null;
  } | null;
  readonly errorCode: string | null;
  readonly errorSummary: string | null;
  readonly createdAt: string;
}

export const PHASE_LABELS: Record<TrainingRun['phase'], string> = {
  QUEUED: 'na fila',
  SNAPSHOT: 'congelando barras D1',
  DATASET: 'montando painel fundamentalista',
  TRAINING: 'treinando escore de fator (walk-forward)',
  GATE: 'aplicando gates',
  FINALIZING: 'finalizando',
};

export const ACTIVE_RUN_STATUSES = new Set(['QUEUED', 'RUNNING', 'CANCEL_REQUESTED']);

export interface ApiError {
  readonly code: string;
  readonly message: string;
}

export async function getJson<T>(url: string): Promise<{ data: T; meta: Record<string, unknown> }> {
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) {
    const error: ApiError = body?.error ?? { code: String(res.status), message: 'falha na requisição' };
    throw error;
  }
  return { data: body.data as T, meta: (body.meta ?? {}) as Record<string, unknown> };
}

export async function postJson<T>(url: string, payload: unknown): Promise<{ data: T; meta: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) {
    const error: ApiError = body?.error ?? { code: String(res.status), message: 'falha na requisição' };
    throw error;
  }
  return { data: body.data as T, meta: (body.meta ?? {}) as Record<string, unknown> };
}

export function isApiError(value: unknown): value is ApiError {
  return typeof value === 'object' && value !== null && 'code' in value && 'message' in value;
}

export function describeError(error: unknown): string {
  return isApiError(error) ? `${error.code}: ${error.message}` : 'erro inesperado';
}

export const pct = (value: number | null | undefined, digits = 1): string =>
  value === null || value === undefined || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(digits)}%`;

export const num = (value: number | null | undefined, digits = 3): string =>
  value === null || value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(digits);

export const shortVersion = (v: string): string => `${v.slice(0, 10)}…${v.slice(-6)}`;

/** Cor do quintil: extremos destacados, meio neutro. Nunca verde/vermelho de compra/venda. */
export const QUANTILE_STYLES: Record<number, string> = {
  5: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/40',
  4: 'bg-cyan-500/5 text-cyan-400/70 border-cyan-500/20',
  3: 'bg-gray-700/30 text-gray-400 border-gray-600/40',
  2: 'bg-amber-500/5 text-amber-400/70 border-amber-500/20',
  1: 'bg-amber-500/10 text-amber-300 border-amber-500/40',
};
