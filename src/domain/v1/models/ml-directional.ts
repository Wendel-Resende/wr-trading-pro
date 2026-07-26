/**
 * Item D — Classificador Direcional com Ensemble Governado.
 * Spec: `docs/architecture/2026-07-25-item-d-directional-classifier-v1.md`.
 *
 * Modelo de domínio puro: nenhuma dependência de Prisma, Flask ou HTTP. As
 * probabilidades chegam aqui já computadas pelo motor Python; o que este
 * módulo garante é o VOCABULÁRIO — quais sinais existem, quais métricas
 * compõem o gate de aceitação e qual é o estado de uma versão de modelo.
 */

/** §4.1 — o gate de confiança só admite estes três estados. */
export type DirectionalSignal = 'COMPRA' | 'VENDA' | 'NEUTRO';

/**
 * DRAFT — aprovado no gate, mas AINDA NÃO publicado. Estado intermediário do
 *   treino assíncrono (Item C): a versão nasce inerte e só vira ACTIVE dentro
 *   de um claim CAS atômico contra o `MlTrainingRun` dono do treino. Um
 *   cancelamento que vença a corrida deixa a versão DRAFT para sempre — órfã,
 *   mas auditável pelo ResearchRun. Nunca aparece na UI nem gera sinais.
 * ACTIVE — publicado; única condição para aparecer na UI e emitir sinais.
 * FAILED — reprovado em ao menos um gate; persistido para auditoria, jamais servível.
 * SUPERSEDED — substituído por uma versão aprovada mais recente.
 */
export type DirectionalModelStatus = 'DRAFT' | 'ACTIVE' | 'FAILED' | 'SUPERSEDED';

/**
 * Códigos de reprovação — allowlist; nunca texto livre vindo do motor.
 *
 * Os quatro primeiros pertencem ao gate de CLASSIFICAÇÃO (versão original da
 * §4.7, substituída em 2026-07-25). Mantidos porque `DirectionalModelVersion`
 * antigas os têm persistidos e a auditoria precisa continuar legível.
 */
export type DirectionalGateFailureCode =
  | 'ACCURACY_BELOW_MIN'
  | 'BRIER_ABOVE_MAX'
  | 'COVERAGE_BELOW_MIN'
  | 'BASELINE_DELTA_BELOW_MIN'
  // Gate de RANKING (atual):
  | 'IC_BELOW_MIN'
  | 'IC_TSTAT_BELOW_MIN'
  | 'TOP_QUANTILE_EXCESS_BELOW_MIN'
  | 'TOP_BOTTOM_SPREAD_BELOW_MIN'
  | 'INCONSISTENT_ACROSS_YEARS';

/** Excesso de retorno observado em cada quintil do escore. */
export interface DirectionalQuantileBucket {
  readonly quantile: number;
  readonly n: number;
  readonly meanExcess: number;
  readonly hitRate: number;
}

export interface DirectionalConfusionMatrix {
  readonly truePositive: number;
  readonly falsePositive: number;
  readonly trueNegative: number;
  readonly falseNegative: number;
}

/** Um ponto do diagrama de confiabilidade (§4.6 item 6). */
export interface DirectionalReliabilityBin {
  readonly binStart: number;
  readonly binEnd: number;
  readonly n: number;
  readonly meanPredicted: number | null;
  readonly observedRate: number | null;
}

export interface DirectionalFoldMetrics {
  readonly foldId: number;
  readonly testYear: number;
  readonly n: number;
  /** Features que passaram no corte de significância naquele fold. */
  readonly nFeatures?: number | null;
  /** IC do fold — `null` quando não houve seção transversal suficiente. */
  readonly ic?: number | null;
  // Campos do motor de classificação anterior, só em versões antigas.
  readonly nHighConfidence?: number;
  readonly accuracy?: number | null;
  readonly brier?: number;
}

/**
 * Métricas out-of-sample do walk-forward.
 *
 * O escore composto (desde 2026-07-25) emite apenas métricas de FATOR: IC,
 * significância, excesso por quintil, spread e consistência. As de
 * classificação seguem OPCIONAIS no contrato porque versões antigas as têm
 * persistidas e a auditoria precisa continuar legível.
 */
export interface DirectionalMetrics {
  readonly nSamples: number;
  /**
   * Métricas do motor de CLASSIFICAÇÃO (até 2026-07-25), agora opcionais: o
   * escore composto ordena empresas e não estima probabilidade. Mantidas no
   * contrato para que versões antigas sigam legíveis na auditoria.
   */
  readonly nHighConfidence?: number;
  readonly nPeriods?: number;
  readonly nFeaturesMedian?: number | null;
  /**
   * `null` quando NÃO houve nenhum sinal de alta confiança: não existe
   * acurácia de sinal a reportar. Zero fingiria "errou tudo" — o gate reprova
   * esse caso por cobertura, não por acurácia inventada.
   */
  readonly accuracy?: number | null;
  readonly accuracyAllSamples?: number;
  readonly brier?: number;
  readonly coverage?: number;
  readonly coveragePeriod?: string | null;
  readonly baselineAllUp?: number;
  readonly baselineOnSignals?: number | null;
  readonly baselineDelta?: number | null;
  /** `true` quando o mapa de calibração foi ajustado em TODOS os folds. */
  readonly calibrated?: boolean;
  /** Brier da probabilidade CRUA (antes da calibração), nas mesmas amostras. */
  readonly brierRaw?: number | null;
  /** Sinais de alta confiança que a probabilidade crua teria emitido. */
  readonly nHighConfidenceRaw?: number | null;
  readonly confusionMatrix?: DirectionalConfusionMatrix;
  readonly reliability?: readonly DirectionalReliabilityBin[];
  readonly byFold: readonly DirectionalFoldMetrics[];

  // --- Métricas de RANKING (instrumento atual, desde 2026-07-25) -----------
  /** Information Coefficient médio: Spearman(escore, excesso) por período. */
  readonly ic?: number | null;
  /** Significância do IC entre períodos (média / erro-padrão). */
  readonly icTStat?: number | null;
  readonly icPeriods?: number;
  readonly quantileExcess?: readonly DirectionalQuantileBucket[];
  readonly topBottomSpread?: number | null;
  readonly spreadByYear?: readonly { readonly testYear: number; readonly spread: number }[];
  readonly positiveYearsRatio?: number | null;

  // --- Economia LÍQUIDA (custos aplicados no servidor a partir do
  // BacktestCostProfile do treino). O bruto fica lado a lado de propósito: a
  // diferença entre os dois é a informação.
  /** Custo de ida-e-volta por posição, em fração do notional. */
  readonly roundTripCost?: number;
  readonly netQuantileExcess?: readonly DirectionalQuantileBucket[];
  readonly netTopBottomSpread?: number | null;
}

export interface DirectionalModelVersion {
  readonly id: string;
  /** Identidade canônica (64 hex) computada no servidor — nunca aceita do cliente. */
  readonly modelVersion: string;
  readonly createdAt: string;
  readonly researchRunId: string;
  readonly metrics: DirectionalMetrics;
  readonly artifactPath: string;
  readonly status: DirectionalModelStatus;
  readonly gateFailures: readonly DirectionalGateFailureCode[];
}

export interface DirectionalModelVersionSubmission {
  readonly modelVersion: string;
  readonly researchRunId: string;
  readonly metrics: DirectionalMetrics;
  readonly artifactPath: string;
  readonly status: DirectionalModelStatus;
  readonly gateFailures: readonly DirectionalGateFailureCode[];
}

export interface DirectionalTopFeature {
  readonly feature: string;
  readonly importance: number;
}

export interface DirectionalPrediction {
  readonly id: string;
  readonly modelVersion: string;
  readonly cdCvm: string;
  readonly ticker: string;
  readonly signal: DirectionalSignal;
  readonly confidence: number;
  /**
   * Percentil transversal do escore no período (0-1). O nome da COLUNA no
   * banco é `prob` por compatibilidade com o motor de classificação anterior;
   * aqui o significado é posição relativa, nunca probabilidade.
   */
  readonly prob: number;
  /** Escore bruto do fator, centrado em 0 (positivo = acima da mediana das pares). */
  readonly score?: number | null;
  /** Quintil no período: 1 = pior, 5 = melhor. É daqui que sai o sinal. */
  readonly quantile?: number | null;
  /** Carimbo de conhecimento (prazo legal) do trimestre que gerou o sinal. */
  readonly knowledgeDate: string;
  readonly topFeatures: readonly DirectionalTopFeature[];
  readonly universeDigest: string;
  readonly generatedAt: string;
}

export interface DirectionalPredictionSubmission {
  readonly modelVersion: string;
  readonly cdCvm: string;
  readonly ticker: string;
  readonly signal: DirectionalSignal;
  readonly confidence: number;
  readonly prob: number;
  readonly score?: number | null;
  readonly quantile?: number | null;
  readonly knowledgeDate: string;
  readonly topFeatures: readonly DirectionalTopFeature[];
  readonly universeDigest: string;
  readonly generatedAt: string;
}
