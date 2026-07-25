import type {
  DirectionalGateFailureCode,
  DirectionalMetrics,
} from '../../domain/v1/models/ml-directional';

/**
 * Item D — gate de aceitação (§4.7).
 *
 * Determinístico e puro: mesmas métricas, mesmo veredito. Um modelo só vira
 * `ACTIVE` se passar nos QUATRO critérios; reprovar em qualquer um o deixa
 * `FAILED`, persistido para auditoria e invisível na UI. O gate nunca é
 * "quase aprovado": não há tolerância, arredondamento nem override manual.
 */

export const DIRECTIONAL_GATE_THRESHOLDS = {
  /** Gate 1 — acurácia direcional nos sinais de alta confiança. */
  minAccuracy: 0.85,
  /** Gate 2 — Brier score (calibração); menor é melhor. */
  maxBrier: 0.15,
  /** Gate 3 — empresas com sinal de alta confiança no último trimestre. */
  minCoverage: 30,
  /** Gate 4 — vantagem sobre o baseline "comprar tudo", em pontos percentuais. */
  minBaselineDelta: 0.15,
} as const;

export interface DirectionalGateResult {
  readonly approved: boolean;
  readonly failures: readonly DirectionalGateFailureCode[];
  readonly checks: readonly {
    readonly code: DirectionalGateFailureCode;
    readonly label: string;
    readonly threshold: number;
    readonly observed: number | null;
    readonly passed: boolean;
  }[];
}

export function evaluateDirectionalGate(metrics: DirectionalMetrics): DirectionalGateResult {
  const t = DIRECTIONAL_GATE_THRESHOLDS;

  // `null` (métrica inexistente — tipicamente nenhum sinal de alta confiança)
  // NUNCA passa: ausência de evidência não é evidência de aprovação.
  const checks = [
    {
      code: 'ACCURACY_BELOW_MIN' as const,
      label: 'Acurácia direcional (alta confiança)',
      threshold: t.minAccuracy,
      observed: metrics.accuracy,
      passed: metrics.accuracy !== null && metrics.accuracy >= t.minAccuracy,
    },
    {
      code: 'BRIER_ABOVE_MAX' as const,
      label: 'Brier score (calibração)',
      threshold: t.maxBrier,
      observed: metrics.brier,
      passed: Number.isFinite(metrics.brier) && metrics.brier < t.maxBrier,
    },
    {
      code: 'COVERAGE_BELOW_MIN' as const,
      label: 'Cobertura no último trimestre',
      threshold: t.minCoverage,
      observed: metrics.coverage,
      passed: metrics.coverage >= t.minCoverage,
    },
    {
      code: 'BASELINE_DELTA_BELOW_MIN' as const,
      label: 'Vantagem sobre comprar-tudo',
      threshold: t.minBaselineDelta,
      observed: metrics.baselineDelta,
      passed: metrics.baselineDelta !== null && metrics.baselineDelta >= t.minBaselineDelta,
    },
  ];

  const failures = checks.filter((c) => !c.passed).map((c) => c.code);
  return { approved: failures.length === 0, failures: Object.freeze(failures), checks: Object.freeze(checks) };
}
