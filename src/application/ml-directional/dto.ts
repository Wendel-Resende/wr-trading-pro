import type {
  DirectionalModelVersion,
  DirectionalPrediction,
} from '../../domain/v1/models/ml-directional';
import { evaluateDirectionalGate } from './gate';

/**
 * Item D — DTOs públicos.
 *
 * Regra central: `artifactPath` NUNCA sai daqui. É um caminho do filesystem
 * do servidor (mesma classe de vazamento que o Guardião apontou no
 * `trainingEvidenceJson` do Item B). Tudo que a UI precisa é a versão, as
 * métricas e o veredito do gate.
 */

export interface DirectionalGateCheckDTO {
  readonly code: string;
  readonly label: string;
  readonly threshold: number;
  readonly observed: number | null;
  readonly passed: boolean;
}

export interface DirectionalModelVersionPublicDTO {
  readonly modelVersion: string;
  readonly createdAt: string;
  readonly researchRunId: string;
  readonly status: string;
  readonly gateApproved: boolean;
  readonly gateFailures: readonly string[];
  readonly gateChecks: readonly DirectionalGateCheckDTO[];
  readonly metrics: {
    readonly nSamples: number;
    readonly nHighConfidence: number;
    readonly accuracy: number | null;
    readonly accuracyAllSamples: number;
    readonly brier: number;
    readonly coverage: number;
    readonly coveragePeriod: string | null;
    readonly baselineAllUp: number;
    readonly baselineOnSignals: number | null;
    readonly baselineDelta: number | null;
    readonly confusionMatrix: DirectionalModelVersion['metrics']['confusionMatrix'];
    readonly reliability: DirectionalModelVersion['metrics']['reliability'];
    readonly byFold: DirectionalModelVersion['metrics']['byFold'];
  };
}

export function toDirectionalModelVersionPublicDTO(
  model: DirectionalModelVersion,
): DirectionalModelVersionPublicDTO {
  // Reavalia o gate na leitura: se os limiares mudarem, a UI mostra a
  // conferência atual contra as métricas gravadas, em vez de um "aprovado"
  // congelado que ninguém consegue reconferir. `status` continua sendo o
  // veredito do momento do treino — os dois convivem, explicitamente.
  const gate = evaluateDirectionalGate(model.metrics);
  return {
    modelVersion: model.modelVersion,
    createdAt: model.createdAt,
    researchRunId: model.researchRunId,
    status: model.status,
    gateApproved: model.status === 'ACTIVE',
    gateFailures: model.gateFailures,
    gateChecks: gate.checks.map((c) => ({
      code: c.code,
      label: c.label,
      threshold: c.threshold,
      observed: c.observed,
      passed: c.passed,
    })),
    metrics: model.metrics,
  };
}

export interface DirectionalPredictionPublicDTO {
  readonly ticker: string;
  readonly cdCvm: string;
  readonly signal: string;
  readonly confidence: number;
  readonly prob: number;
  readonly knowledgeDate: string;
  readonly topFeatures: readonly { readonly feature: string; readonly importance: number }[];
  readonly modelVersion: string;
  readonly universeDigest: string;
  readonly generatedAt: string;
}

export function toDirectionalPredictionPublicDTO(p: DirectionalPrediction): DirectionalPredictionPublicDTO {
  return {
    ticker: p.ticker,
    cdCvm: p.cdCvm,
    signal: p.signal,
    confidence: p.confidence,
    prob: p.prob,
    knowledgeDate: p.knowledgeDate,
    topFeatures: p.topFeatures,
    modelVersion: p.modelVersion,
    universeDigest: p.universeDigest,
    generatedAt: p.generatedAt,
  };
}
