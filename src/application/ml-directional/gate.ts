import type {
  DirectionalGateFailureCode,
  DirectionalMetrics,
} from '../../domain/v1/models/ml-directional';

/**
 * Item D — gate de aceitação.
 *
 * REESCRITO em 2026-07-25. Os critérios originais da §4.7 (acurácia ≥ 85%,
 * Brier < 0,15, cobertura ≥ 30, vantagem ≥ 15 p.p.) mediam CLASSIFICAÇÃO
 * BINÁRIA. Medido sobre os dados reais, esse é o instrumento errado para este
 * problema: a vantagem do modelo vive na ORDENAÇÃO das empresas dentro de cada
 * trimestre, e a classificação binária a destrói — uma empresa no percentil 51
 * e outra no percentil 99 recebem o mesmo rótulo "sobe", enquanto o excesso de
 * retorno entre quintis difere em vários pontos percentuais.
 *
 * Os critérios abaixo medem o fator: informação (IC), significância (t-stat),
 * retorno econômico do topo, spread topo-fundo e consistência entre anos.
 *
 * Continua determinístico e sem tolerância: reprovar em qualquer critério
 * deixa o modelo `FAILED`, persistido para auditoria e invisível na UI.
 */

export const DIRECTIONAL_GATE_THRESHOLDS = {
  /**
   * Gate 1 — Information Coefficient médio (Spearman escore × excesso, por
   * período). 0,02 é o piso reconhecido para um fator utilizável em ações;
   * fatores clássicos vivem entre 0,02 e 0,05.
   */
  minIc: 0.02,
  /** Gate 2 — significância do IC (média/erro-padrão entre períodos). */
  minIcTStat: 2.0,
  /**
   * Gate 3 — excesso de retorno do quintil SUPERIOR, por trimestre. Existe
   * porque IC significativo não implica topo lucrativo: o IC pode vir
   * inteiramente do quintil inferior ser ruim. Quem compra o topo precisa que
   * o topo pague. 0,5% ao trimestre (~2% ao ano) é um piso deliberadamente
   * modesto.
   */
  minTopQuantileExcess: 0.005,
  /** Gate 4 — spread topo-fundo positivo: a ordenação precisa separar. */
  minTopBottomSpread: 0,
  /** Gate 5 — fração de anos com spread positivo. Fator que só funciona em um ano não é fator. */
  minPositiveYearsRatio: 0.6,
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

/** `null`/não-finito NUNCA passa: ausência de evidência não é evidência de aprovação. */
function atLeast(observed: number | null | undefined, threshold: number): boolean {
  return observed !== null && observed !== undefined && Number.isFinite(observed) && observed >= threshold;
}

function above(observed: number | null | undefined, threshold: number): boolean {
  return observed !== null && observed !== undefined && Number.isFinite(observed) && observed > threshold;
}

export function evaluateDirectionalGate(metrics: DirectionalMetrics): DirectionalGateResult {
  const t = DIRECTIONAL_GATE_THRESHOLDS;

  // Avalia a economia LÍQUIDA de custos quando ela existe. Aprovar um fator
  // pelo retorno bruto seria aprovar algo que a corretagem come antes de
  // chegar ao usuário — o `BacktestCostProfile` exigido no treino existe
  // exatamente para esta conta.
  const topQuantile = topQuantileExcess(metrics);
  const spread = metrics.netTopBottomSpread ?? metrics.topBottomSpread;

  const checks = [
    {
      code: 'IC_BELOW_MIN' as const,
      label: 'Information Coefficient médio',
      threshold: t.minIc,
      observed: metrics.ic ?? null,
      passed: atLeast(metrics.ic, t.minIc),
    },
    {
      code: 'IC_TSTAT_BELOW_MIN' as const,
      label: 'Significância do IC (t-stat)',
      threshold: t.minIcTStat,
      observed: metrics.icTStat ?? null,
      passed: atLeast(metrics.icTStat, t.minIcTStat),
    },
    {
      code: 'TOP_QUANTILE_EXCESS_BELOW_MIN' as const,
      label: 'Excesso do quintil superior, líquido de custos (por trimestre)',
      threshold: t.minTopQuantileExcess,
      observed: topQuantile,
      passed: atLeast(topQuantile, t.minTopQuantileExcess),
    },
    {
      code: 'TOP_BOTTOM_SPREAD_BELOW_MIN' as const,
      label: 'Spread topo − fundo, líquido de custos',
      threshold: t.minTopBottomSpread,
      observed: spread ?? null,
      passed: above(spread, t.minTopBottomSpread),
    },
    {
      code: 'INCONSISTENT_ACROSS_YEARS' as const,
      label: 'Anos com spread positivo',
      threshold: t.minPositiveYearsRatio,
      observed: metrics.positiveYearsRatio ?? null,
      passed: atLeast(metrics.positiveYearsRatio, t.minPositiveYearsRatio),
    },
  ];

  const failures = checks.filter((c) => !c.passed).map((c) => c.code);
  return { approved: failures.length === 0, failures: Object.freeze(failures), checks: Object.freeze(checks) };
}

/**
 * Excesso do quintil de maior escore, LÍQUIDO de custos quando disponível.
 * Cai para o bruto apenas em versões treinadas antes de 2026-07-25, que não
 * têm a decomposição líquida — nunca para "ignorar custos" por conveniência.
 */
export function topQuantileExcess(metrics: DirectionalMetrics): number | null {
  const buckets = metrics.netQuantileExcess ?? metrics.quantileExcess;
  if (!buckets || buckets.length === 0) return null;
  const top = buckets.reduce((a, b) => (b.quantile > a.quantile ? b : a));
  return top.meanExcess;
}
