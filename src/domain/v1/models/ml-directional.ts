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

/** Códigos de reprovação — allowlist; nunca texto livre vindo do motor. */
export type DirectionalGateFailureCode =
  | 'ACCURACY_BELOW_MIN'
  | 'BRIER_ABOVE_MAX'
  | 'COVERAGE_BELOW_MIN'
  | 'BASELINE_DELTA_BELOW_MIN';

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
  readonly nHighConfidence: number;
  readonly accuracy: number | null;
  readonly brier: number;
}

/**
 * Métricas out-of-sample do walk-forward. `accuracy` é medida APENAS sobre os
 * sinais de alta confiança (é o que se opera); `accuracyAllSamples` fica à
 * parte, como referência, e nunca participa do gate.
 */
export interface DirectionalMetrics {
  readonly nSamples: number;
  readonly nHighConfidence: number;
  /**
   * `null` quando NÃO houve nenhum sinal de alta confiança: não existe
   * acurácia de sinal a reportar. Zero fingiria "errou tudo" — o gate reprova
   * esse caso por cobertura, não por acurácia inventada.
   */
  readonly accuracy: number | null;
  readonly accuracyAllSamples: number;
  readonly brier: number;
  readonly coverage: number;
  readonly coveragePeriod: string | null;
  readonly baselineAllUp: number;
  readonly baselineOnSignals: number | null;
  readonly baselineDelta: number | null;
  /** `true` quando o mapa de calibração foi ajustado em TODOS os folds. */
  readonly calibrated?: boolean;
  /** Brier da probabilidade CRUA (antes da calibração), nas mesmas amostras. */
  readonly brierRaw?: number | null;
  /** Sinais de alta confiança que a probabilidade crua teria emitido. */
  readonly nHighConfidenceRaw?: number | null;
  readonly confusionMatrix: DirectionalConfusionMatrix;
  readonly reliability: readonly DirectionalReliabilityBin[];
  readonly byFold: readonly DirectionalFoldMetrics[];
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
  /** Probabilidade crua de alta, ANTES do gate — proximidade do corte, nunca recomendação. */
  readonly prob: number;
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
  readonly knowledgeDate: string;
  readonly topFeatures: readonly DirectionalTopFeature[];
  readonly universeDigest: string;
  readonly generatedAt: string;
}
